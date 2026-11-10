import { connect as connectTls, type TLSSocket } from "node:tls";

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

  return {
    host,
    port,
    user,
    password,
    from: requiredAddress(from, "sender"),
  };
}

class SmtpSession {
  private buffer = "";
  private responseLines: string[] = [];
  private readonly responses: string[][] = [];
  private readonly waiters: Array<{
    resolve: (lines: string[]) => void;
    reject: (error: Error) => void;
  }> = [];
  private failure: Error | null = null;

  constructor(private readonly socket: TLSSocket) {
    socket.setTimeout(15_000, () => socket.destroy(new Error("SMTP connection timed out.")));
    socket.on("data", (chunk: Buffer) => this.receive(chunk.toString("utf8")));
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("SMTP connection closed unexpectedly.")));
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
}

function encodeSubject(subject: string) {
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

export async function sendEmail(message: MailMessage) {
  const configuration = getSmtpConfiguration();
  const recipient = requiredAddress(message.to, "recipient");
  if (/[\r\n]/.test(message.subject)) throw new Error("Email subject cannot contain line breaks.");

  const socket = connectTls({
    host: configuration.host,
    port: configuration.port,
    servername: configuration.host,
    rejectUnauthorized: true,
  });
  socket.setTimeout(15_000, () => socket.destroy(new Error("SMTP connection timed out.")));
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });

    const smtp = new SmtpSession(socket);
    await smtp.ready();
    await smtp.command(`EHLO ${configuration.host}`, [250]);
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
    await smtp.command("QUIT", [221]);
  } finally {
    socket.end();
  }
}
