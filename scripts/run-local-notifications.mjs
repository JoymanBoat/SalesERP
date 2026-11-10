import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { runScheduledNotifications } from "./local-notifications-client.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const settings = dotenv.parse(readFileSync(join(root, ".env")));
const secret = settings.NOTIFICATIONS_CRON_SECRET;
const port = settings.APP_PORT || "3000";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("APP_PORT must be a valid TCP port.");

const result = await runScheduledNotifications(`http://127.0.0.1:${port}`, secret);
console.log(`Notifications: created=${result.created}, email sent=${result.sent}, email failed=${result.failed}.`);
