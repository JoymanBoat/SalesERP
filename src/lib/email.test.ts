import { afterEach, describe, expect, it } from "vitest";

import { sendEmail } from "./email";

const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD"] as const;
const originalValues = new Map(smtpKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of smtpKeys) {
    const originalValue = originalValues.get(key);
    if (originalValue === undefined) delete process.env[key];
    else process.env[key] = originalValue;
  }
});

describe("sendEmail", () => {
  it("requires a configured TLS SMTP host and sender", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;

    await expect(sendEmail({ to: "person@example.com", subject: "Reset", text: "Body" }))
      .rejects.toThrow("SMTP_HOST must be a valid DNS hostname.");
  });

  it("rejects malformed recipient addresses before opening a connection", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "support@example.com";
    process.env.SMTP_PORT = "465";
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;

    await expect(sendEmail({ to: "bad\r\nBcc: other@example.com", subject: "Reset", text: "Body" }))
      .rejects.toThrow("SMTP recipient must be a plain email address.");
  });

  it("rejects header injection before opening a connection", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "support@example.com";
    process.env.SMTP_PORT = "465";
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;

    await expect(sendEmail({ to: "person@example.com", subject: "Reset\r\nBcc: other@example.com", text: "Body" }))
      .rejects.toThrow("Email subject cannot contain line breaks.");
  });
});
