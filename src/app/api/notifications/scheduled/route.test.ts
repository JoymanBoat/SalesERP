import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runScheduledNotifications } = vi.hoisted(() => ({
  runScheduledNotifications: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({ runScheduledNotifications }));

import { POST } from "./route";

const originalSecret = process.env.NOTIFICATIONS_CRON_SECRET;

beforeEach(() => {
  runScheduledNotifications.mockReset();
  process.env.NOTIFICATIONS_CRON_SECRET = "a".repeat(32);
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.NOTIFICATIONS_CRON_SECRET;
  else process.env.NOTIFICATIONS_CRON_SECRET = originalSecret;
});

describe("POST /api/notifications/scheduled", () => {
  it("rejects requests when the scheduler secret is not configured", async () => {
    delete process.env.NOTIFICATIONS_CRON_SECRET;

    const response = await POST(new Request("https://saleserp.example/api/notifications/scheduled", { method: "POST" }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runScheduledNotifications).not.toHaveBeenCalled();
  });

  it("rejects missing and incorrect bearer tokens", async () => {
    const response = await POST(new Request("https://saleserp.example/api/notifications/scheduled", {
      method: "POST",
      headers: { authorization: `Bearer ${"b".repeat(32)}` },
    }));

    expect(response.status).toBe(401);
    expect(runScheduledNotifications).not.toHaveBeenCalled();
  });

  it("runs the daily job only for a valid bearer token", async () => {
    runScheduledNotifications.mockResolvedValue({ created: 4, sent: 3, failed: 1 });
    const response = await POST(new Request("https://saleserp.example/api/notifications/scheduled", {
      method: "POST",
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ created: 4, sent: 3, failed: 1 });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runScheduledNotifications).toHaveBeenCalledOnce();
  });

  it("does not expose internal job errors", async () => {
    runScheduledNotifications.mockRejectedValue(new Error("internal database detail"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(new Request("https://saleserp.example/api/notifications/scheduled", {
      method: "POST",
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Scheduled notifications could not be completed.",
    });
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });
});
