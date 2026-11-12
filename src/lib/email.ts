import { createConnection, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";

type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

type SmtpConfiguration = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  security: "implicit" | "starttls";
};

function requiredAddress(value: string, label: string) {
  const addressPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
  if (value.length > 254 || !addressPattern.test(value)) {
    throw new Error(`SMTP ${label} must be a plain email address.`);
  }
  return value;
}

function getSmtpConfiguration(): SmtpConfiguration {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT ?? "465");
  const user = process.env.SMTP_USER ?? "";
  const password = process.env.SMTP_PASSWORD ?? "";
  const from = process.env.SMTP_FROM?.trim();
  const security = process.env.SMTP_SECURITY || "implicit";

  if (!host || !/^[A-Za-z0-9.-]+$/.test(host)) {
    throw new Error("SMTP_HOST must be a valid DNS hostname.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMTP_PORT must be a valid TCP port.");
  }
  if (!from) throw new Error("SMTP_FROM is required.");
  if (Boolean(user) !== Boolean(password)) {
    throw new Error("Set both SMTP_USER and SMTP_PASSWORD, or leave both empty.");
  }
  if (security !== "implicit" && security !== "starttls") {
    throw new Error("SMTP_SECURITY must be implicit or starttls.");
  }

  return {
    host,
    port,
    user,
    password,
    from: requiredAddress(from, "sender"),
    security,
  };
}

class SmtpSession {
  private readonly socket: Socket;
  private buffer = "";
  private responseLines: string[] = [];
  private readonly responses: string[][] = [];
  private readonly waiters: Array<{
    resolve: (lines: string[]) => void;
    reject: (error: Error) => void;
  }> = [];
  private failure: Error | null = null;

  private readonly onData = (chunk: Buffer) => this.receive(chunk.toString("utf8"));
  private readonly onError = (error: Error) => this.fail(error);
  private readonly onClose = () => this.fail(new Error("SMTP connection closed unexpectedly."));
  private readonly onTimeout = () => this.socket.destroy(new Error("SMTP connection timed out."));

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setTimeout(15_000);
    socket.on("timeout", this.onTimeout);
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line) continue;
      this.responseLines.push(line);
      if (/^\d{3} /.test(line)) {
        const response = this.responseLines;
        this.responseLines = [];
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(response);
        else this.responses.push(response);
      }
    }
  }

  private fail(error: Error) {
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  private readResponse() {
    const response = this.responses.shift();
    if (response) return Promise.resolve(response);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<string[]>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private async checkResponse(expectedCodes: number[]) {
    const response = await this.readResponse();
    const code = Number(response[response.length - 1]?.slice(0, 3));
    if (!expectedCodes.includes(code)) {
      throw new Error(`SMTP server rejected a command with response ${code || "unknown"}.`);
    }
    return response;
  }

  async command(command: string, expectedCodes: number[]) {
    this.socket.write(`${command}\r\n`);
    return this.checkResponse(expectedCodes);
  }

  async data(message: string) {
    this.socket.write(`${message.replace(/^\./gm, "..")}\r\n.\r\n`);
    await this.checkResponse([250]);
  }

  async ready() {
    await this.checkResponse([220]);
  }

  detach() {
    if (this.failure) throw this.failure;
    if (this.buffer || this.responseLines.length || this.responses.length || this.waiters.length) {
      throw new Error("Unexpected SMTP data before TLS upgrade.");
    }
    this.socket.off("timeout", this.onTimeout);
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
  }
}

async function waitForSecureConnection(socket: ReturnType<typeof connectTls>) {
  const onTimeout = () => socket.destroy(new Error("SMTP connection timed out."));
  socket.setTimeout(15_000);
  socket.on("timeout", onTimeout);
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.off("secureConnect", onSecure);
        socket.off("error", onError);
        socket.off("close", onClose);
      };
      const onSecure = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onClose = () => { cleanup(); reject(new Error("SMTP connection closed during TLS negotiation.")); };
      socket.once("secureConnect", onSecure);
      socket.once("error", onError);
      socket.once("close", onClose);
    });
  } finally {
    socket.off("timeout", onTimeout);
    socket.setTimeout(0);
  }
}

function encodeSubject(subject: string) {
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

export async function sendEmail(message: MailMessage) {
  const configuration = getSmtpConfiguration();
  const recipient = requiredAddress(message.to, "recipient");
  if (/[\r\n]/.test(message.subject)) throw new Error("Email subject cannot contain line breaks.");

  let socket: Socket | undefined;
  let smtp: SmtpSession;
  const deadline = setTimeout(() => socket?.destroy(new Error("SMTP delivery exceeded its 20-second deadline.")), 20_000);
  try {
    if (configuration.security === "implicit") {
      const tlsSocket = connectTls({
        host: configuration.host,
        port: configuration.port,
        servername: configuration.host,
        rejectUnauthorized: true,
      });
      socket = tlsSocket;
      await waitForSecureConnection(tlsSocket);
      smtp = new SmtpSession(socket);
    } else {
      socket = createConnection({ host: configuration.host, port: configuration.port });
      smtp = new SmtpSession(socket);
    }
    await smtp.ready();
    const capabilities = await smtp.command(`EHLO ${configuration.host}`, [250]);
    if (configuration.security === "starttls") {
      if (!capabilities.some((line) => /^250[ -]STARTTLS(?:\s|$)/i.test(line))) {
        throw new Error("SMTP server does not advertise STARTTLS.");
      }
      await smtp.command("STARTTLS", [220]);
      smtp.detach();
      const tlsSocket = connectTls({ socket, servername: configuration.host, rejectUnauthorized: true });
      socket = tlsSocket;
      await waitForSecureConnection(tlsSocket);
      smtp = new SmtpSession(tlsSocket);
      await smtp.command(`EHLO ${configuration.host}`, [250]);
    }
    if (configuration.user) {
      await smtp.command("AUTH LOGIN", [334]);
      await smtp.command(Buffer.from(configuration.user, "utf8").toString("base64"), [334]);
      await smtp.command(Buffer.from(configuration.password, "utf8").toString("base64"), [235]);
    }
    await smtp.command(`MAIL FROM:<${configuration.from}>`, [250]);
    await smtp.command(`RCPT TO:<${recipient}>`, [250, 251]);
    await smtp.command("DATA", [354]);

    const body = message.text.replace(/\r\n|\r|\n/g, "\r\n");
    const mimeMessage = [
      `From: ${configuration.from}`,
      `To: ${recipient}`,
      `Subject: ${encodeSubject(message.subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
    ].join("\r\n");
    await smtp.data(mimeMessage);
    try {
      await smtp.command("QUIT", [221]);
    } catch (error) {
      console.warn("SMTP message was accepted, but closing the session failed.", error);
    }
  } finally {
    clearTimeout(deadline);
    socket?.destroy();
  }
}
