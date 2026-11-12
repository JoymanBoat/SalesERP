import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export async function sendOperationsAlert(settings, send) {
  const recipient = settings.OPERATIONS_ALERT_EMAIL || settings.SMTP_FROM;
  if (!recipient) throw new Error("Set OPERATIONS_ALERT_EMAIL or SMTP_FROM for operations alerts.");
  await send({
    to: recipient,
    subject: "SalesERP local operations check failed",
    text: "A local SalesERP operations check failed. Review the application health, backup and scheduler logs on your computer.",
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const settings = dotenv.parse(readFileSync(join(root, ".env")));
  for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURITY", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD"]) {
    if (settings[key] === undefined) delete process.env[key];
    else process.env[key] = settings[key];
  }
  const { sendEmail } = await import("../src/lib/email.ts");
  await sendOperationsAlert(settings, sendEmail);
  console.log("Operations alert accepted by the SMTP server.");
}
