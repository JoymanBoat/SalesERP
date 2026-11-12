import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const result = dotenv.config({ path: resolve(root, ".env"), override: true });
if (result.error) throw result.error;
const recipient = process.argv[2];
if (!recipient) throw new Error("Provide a test recipient email address.");
const { sendEmail } = await import("../src/lib/email.ts");
await sendEmail({
  to: recipient,
  subject: "SalesERP SMTP test",
  text: "This is a test of your SalesERP SMTP configuration. No account or password-reset link is included.",
});
console.log("Test email accepted by the SMTP server. Check the recipient's inbox and spam folder.");
