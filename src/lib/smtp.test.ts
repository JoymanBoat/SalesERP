import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("node:tls", () => ({ connect }));

import { sendEmail } from "./email";

class FakeTlsSocket extends EventEmitter {
  writes: string[] = [];

  setTimeout() {
    return this;
  }

  write(chunk: string) {
    this.writes.push(chunk);
    const command = chunk.trim();
    const isAuthPayload = /^[A-Za-z0-9+/]+=*$/.test(command);
    const authPayloadCount = this.writes.filter((write) => /^[A-Za-z0-9+/]+=*$/.test(write.trim())).length;
    const response = command.startsWith("EHLO ")
      ? "250-mail.example\r\n250 AUTH LOGIN\r\n"
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

  end() {}
}

describe("SMTP TLS delivery", () => {
  const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD"] as const;
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
});
