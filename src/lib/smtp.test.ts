import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connect, createConnection } = vi.hoisted(() => ({ connect: vi.fn(), createConnection: vi.fn() }));

vi.mock("node:tls", () => ({ connect }));
vi.mock("node:net", () => ({ createConnection }));

import { sendEmail } from "./email";

class FakeTlsSocket extends EventEmitter {
  writes: string[] = [];
  advertiseStarttls = true;
  starttlsResponse = "220 Ready to start TLS\r\n";

  setTimeout() {
    return this;
  }

  write(chunk: string) {
    this.writes.push(chunk);
    const command = chunk.trim();
    const isAuthPayload = /^[A-Za-z0-9+/]+=*$/.test(command);
    const authPayloadCount = this.writes.filter((write) => /^[A-Za-z0-9+/]+=*$/.test(write.trim())).length;
    const response = command.startsWith("EHLO ")
      ? `250-mail.example\r\n${this.advertiseStarttls ? "250-STARTTLS\r\n" : ""}250 AUTH LOGIN\r\n`
      : command === "STARTTLS"
        ? this.starttlsResponse
      : command === "AUTH LOGIN"
        ? "334 VXNlcm5hbWU6\r\n"
        : command === "DATA"
          ? "354 End data with <CR><LF>.<CR><LF>\r\n"
          : command === "QUIT"
            ? "221 2.0.0 Bye\r\n"
          : isAuthPayload && authPayloadCount === 1
            ? "334 UGFzc3dvcmQ6\r\n"
            : isAuthPayload && this.writes.some((write) => write.trim() === "AUTH LOGIN")
              ? "235 2.7.0 Authenticated\r\n"
              : command.startsWith("MAIL FROM:") || command.startsWith("RCPT TO:")
                ? "250 2.1.0 Accepted\r\n"
                : chunk.endsWith("\r\n.\r\n")
                  ? "250 2.0.0 Message accepted\r\n"
                  : "";
    if (response) setImmediate(() => this.emit("data", Buffer.from(response)));
    return true;
  }

  destroy() {}
}

describe("SMTP TLS delivery", () => {
  const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD", "SMTP_SECURITY"] as const;
  const originalValues = new Map(keys.map((key) => [key, process.env[key]]));
  let socket: FakeTlsSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    socket = new FakeTlsSocket();
    connect.mockImplementation((options: unknown) => {
      expect(options).toEqual(expect.objectContaining({
        host: "smtp.example.com",
        port: 465,
        rejectUnauthorized: true,
      }));
      queueMicrotask(() => socket.emit("secureConnect"));
      setTimeout(() => socket.emit("data", Buffer.from("220 smtp.example.com ready\r\n")), 0);
      return socket;
    });
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_FROM = "support@example.com";
    process.env.SMTP_USER = "smtp-user";
    process.env.SMTP_PASSWORD = "smtp-password";
    delete process.env.SMTP_SECURITY;
  });

  afterEach(() => {
    for (const key of keys) {
      const originalValue = originalValues.get(key);
      if (originalValue === undefined) delete process.env[key];
      else process.env[key] = originalValue;
    }
  });

  it("uses authenticated implicit TLS and safely submits a plain-text message", async () => {
    await sendEmail({
      to: "person@example.com",
      subject: "Reset your password",
      text: "First line\n.second line",
    });

    expect(connect).toHaveBeenCalledOnce();
    expect(socket.writes).toEqual(expect.arrayContaining([
      "AUTH LOGIN\r\n",
      "MAIL FROM:<support@example.com>\r\n",
      "RCPT TO:<person@example.com>\r\n",
      "DATA\r\n",
    ]));
    expect(socket.writes.some((write) => write.includes("Subject: =?UTF-8?B?"))).toBe(true);
    expect(socket.writes.some((write) => write.includes("\r\n..second line\r\n.\r\n"))).toBe(true);
    expect(socket.writes.at(-1)).toBe("QUIT\r\n");
  });

    it("upgrades with verified TLS before sending credentials and repeats EHLO", async () => {
      const plain = new FakeTlsSocket();
      const tls = new FakeTlsSocket();
      process.env.SMTP_PORT = "587";
      process.env.SMTP_SECURITY = "starttls";
      createConnection.mockImplementation(() => {
        setTimeout(() => plain.emit("data", Buffer.from("220 smtp.example.com ready\r\n")), 0);
        return plain;
      });
      connect.mockImplementation((options: unknown) => {
        expect(options).toEqual({ socket: plain, servername: "smtp.example.com", rejectUnauthorized: true });
        expect(plain.writes).toEqual(["EHLO smtp.example.com\r\n", "STARTTLS\r\n"]);
        queueMicrotask(() => tls.emit("secureConnect"));
        return tls;
      });
      await sendEmail({ to: "person@example.com", subject: "Test", text: "Body" });
      expect(tls.writes.slice(0, 2)).toEqual(["EHLO smtp.example.com\r\n", "AUTH LOGIN\r\n"]);
      expect(createConnection).toHaveBeenCalledWith({ host: "smtp.example.com", port: 587 });
    });

    it("refuses to authenticate if STARTTLS is not advertised or rejected", async () => {
      const plain = new FakeTlsSocket();
      process.env.SMTP_SECURITY = "starttls";
      plain.advertiseStarttls = false;
      createConnection.mockImplementation(() => {
        setTimeout(() => plain.emit("data", Buffer.from("220 ready\r\n")), 0);
        return plain;
      });
      await expect(sendEmail({ to: "person@example.com", subject: "Test", text: "Body" })).rejects.toThrow("does not advertise STARTTLS");
      expect(connect).not.toHaveBeenCalled();
      expect(plain.writes).toEqual(["EHLO smtp.example.com\r\n"]);

      plain.advertiseStarttls = true;
      plain.starttlsResponse = "454 TLS unavailable\r\n";
      plain.writes = [];
      await expect(sendEmail({ to: "person@example.com", subject: "Test", text: "Body" })).rejects.toThrow("454");
      expect(connect).not.toHaveBeenCalled();
      expect(plain.writes).toEqual(["EHLO smtp.example.com\r\n", "STARTTLS\r\n"]);
    });

    it("does not send credentials when the TLS handshake fails", async () => {
      const plain = new FakeTlsSocket();
      const tls = new FakeTlsSocket();
      process.env.SMTP_SECURITY = "starttls";
      createConnection.mockImplementation(() => {
        setTimeout(() => plain.emit("data", Buffer.from("220 ready\r\n")), 0);
        return plain;
      });
      connect.mockImplementation(() => {
        queueMicrotask(() => tls.emit("error", new Error("certificate rejected")));
        return tls;
      });
      await expect(sendEmail({ to: "person@example.com", subject: "Test", text: "Body" })).rejects.toThrow("certificate rejected");
      expect(tls.writes).toEqual([]);
    });

});
