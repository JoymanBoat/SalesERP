import { describe, expect, it } from "vitest";

import { createReceiptToken, readReceiptToken } from "./receipt-link";
import { normalizeReceiptPhone } from "./receipt-phone";

const orderId = "clh1p2s3t0000qwertyuiopas";
const secret = "test-secret-at-least-32-characters-long";
const start = Date.UTC(2026, 0, 1);
const duration = 30 * 24 * 60 * 60 * 1000;

describe("receipt links", () => {
  it("accepts a signed link before expiry and rejects it at 30 days", () => {
    const token = createReceiptToken(orderId, secret, start);
    expect(readReceiptToken(token, secret, start + duration - 1000)?.orderId).toBe(orderId);
    expect(readReceiptToken(token, secret, start + duration)).toBeNull();
  });

  it("rejects altered tokens, different secrets, and malformed inputs", () => {
    const token = createReceiptToken(orderId, secret, start);
    expect(readReceiptToken(`${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`, secret, start)).toBeNull();
    expect(readReceiptToken(token, `${secret}changed`, start)).toBeNull();
    expect(readReceiptToken("invalid", secret, start)).toBeNull();
  });

  it("normalizes Ghana and international numbers without accepting invalid characters", () => {
    expect(normalizeReceiptPhone("024 123 4567")).toBe("233241234567");
    expect(normalizeReceiptPhone("+44 20 1234 5678")).toBe("442012345678");
    expect(normalizeReceiptPhone("0241234567;body=other")).toBeNull();
    expect(normalizeReceiptPhone("123")).toBeNull();
  });
});
