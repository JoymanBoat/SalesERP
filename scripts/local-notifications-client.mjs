export async function runScheduledNotifications(base, secret, request = fetch) {
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("NOTIFICATIONS_CRON_SECRET must be set in .env to at least 32 bytes.");
  const response = await request(`${base}/api/notifications/scheduled`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Notification scheduler returned HTTP ${response.status}.`);
  const result = await response.json();
  if (!result || typeof result !== "object"
    || !Number.isSafeInteger(result.created) || !Number.isSafeInteger(result.sent) || !Number.isSafeInteger(result.failed)
    || result.created < 0 || result.sent < 0 || result.failed < 0) {
    throw new Error("Notification scheduler returned an invalid result.");
  }
  if (result.failed > 0) throw new Error(`Notification email delivery failed for ${result.failed} messages; check application logs and SMTP configuration.`);
  return result;
}
