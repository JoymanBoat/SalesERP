import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runScheduledNotifications } from "./local-notifications-client.mjs";

describe("local notification scheduler", () => {
  const secret = "a".repeat(32);
  it("sends a bearer-protected POST and reports counts", async () => {
    const request = async (url, options) => {
      assert.equal(url, "http://127.0.0.1:3000/api/notifications/scheduled");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, `Bearer ${secret}`);
      return Response.json({ created: 3, sent: 2, failed: 0, hasMore: false });
    };
    assert.deepEqual(await runScheduledNotifications("http://127.0.0.1:3000", secret, request), { created: 3, sent: 2, failed: 0 });
  });
  it("surfaces authentication, malformed responses, and delivery failures", async () => {
    await assert.rejects(runScheduledNotifications("http://localhost", "short"), /at least 32 bytes/);
    await assert.rejects(runScheduledNotifications("http://localhost", secret, async () => new Response(null, { status: 401 })), /HTTP 401/);
    await assert.rejects(runScheduledNotifications("http://localhost", secret, async () => Response.json(null)), /invalid result/);
    await assert.rejects(runScheduledNotifications("http://localhost", secret, async () => Response.json({ created: -1, sent: 0, failed: 0 })), /invalid result/);
    await assert.rejects(runScheduledNotifications("http://localhost", secret, async () => Response.json({ created: 0, sent: 0, failed: 1, hasMore: false })), /delivery failed/);
  });

  it("drains additional batches without regenerating notifications", async () => {
    const urls = [];
    const request = async (url) => {
      urls.push(url);
      return Response.json(urls.length === 1
        ? { created: 5, sent: 3, failed: 0, hasMore: true }
        : { created: 0, sent: 2, failed: 0, hasMore: false });
    };
    assert.deepEqual(await runScheduledNotifications("http://localhost", secret, request), { created: 5, sent: 5, failed: 0 });
    assert.deepEqual(urls, [
      "http://localhost/api/notifications/scheduled",
      "http://localhost/api/notifications/scheduled?deliveryOnly=1",
    ]);
  });
});
