import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sendOperationsAlert } from "./operations-alert.mjs";

describe("local operations alert", () => {
  it("uses the configured alert recipient without including operational details", async () => {
    let message;
    await sendOperationsAlert({ OPERATIONS_ALERT_EMAIL: "alerts@example.com", SMTP_FROM: "sender@example.com" }, async (value) => { message = value; });
    assert.equal(message.to, "alerts@example.com");
    assert.match(message.subject, /operations check failed/);
    assert.match(message.text, /Review/);
  });

  it("defaults to the sender and reports configuration and delivery failures", async () => {
    let recipient;
    await sendOperationsAlert({ SMTP_FROM: "sender@example.com" }, async (message) => { recipient = message.to; });
    assert.equal(recipient, "sender@example.com");
    await assert.rejects(sendOperationsAlert({}, async () => {}), /Set OPERATIONS_ALERT_EMAIL or SMTP_FROM/);
    await assert.rejects(sendOperationsAlert({ SMTP_FROM: "sender@example.com" }, async () => { throw new Error("SMTP unavailable"); }), /SMTP unavailable/);
  });
});
