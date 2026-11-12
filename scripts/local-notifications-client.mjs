export async function runScheduledNotifications(base, secret, request = fetch) {
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("NOTIFICATIONS_CRON_SECRET must be set in .env to at least 32 bytes.");
  const total = { created: 0, sent: 0, failed: 0 };
  const deadline = Date.now() + 180_000;
  let deliveryOnly = false;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Notification scheduler exceeded its 3-minute deadline; pending messages will be retried on the next run.");
    const response = await request(`${base}/api/notifications/scheduled${deliveryOnly ? "?deliveryOnly=1" : ""}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(Math.min(120_000, remaining)),
    });
    if (!response.ok) throw new Error(`Notification scheduler returned HTTP ${response.status}.`);
    const result = await response.json();
    if (!result || typeof result !== "object"
      || !Number.isSafeInteger(result.created) || !Number.isSafeInteger(result.sent) || !Number.isSafeInteger(result.failed)
      || result.created < 0 || result.sent < 0 || result.failed < 0 || typeof result.hasMore !== "boolean") {
      throw new Error("Notification scheduler returned an invalid result.");
    }
    total.created += result.created;
    total.sent += result.sent;
    total.failed += result.failed;
    if (total.failed > 0) throw new Error(`Notification email delivery failed for ${total.failed} messages; check application logs and SMTP configuration.`);
    if (!result.hasMore) return total;
    deliveryOnly = true;
  }
}
