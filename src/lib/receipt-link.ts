import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const lifetimeSeconds = 30 * 24 * 60 * 60;
const payloadSchema = z.object({
  orderId: z.string().cuid(),
  expires: z.number().int().positive(),
});

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`receipt-v1.${payload}`).digest("base64url");
}

export function createReceiptToken(orderId: string, secret: string, now = Date.now()) {
  if (!secret || !payloadSchema.shape.orderId.safeParse(orderId).success) throw new Error("Receipt link configuration is invalid.");
  const payload = Buffer.from(JSON.stringify({ orderId, expires: Math.floor(now / 1000) + lifetimeSeconds })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function readReceiptToken(token: string, secret: string, now = Date.now()) {
  if (!secret || token.length > 512 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [payload, received] = token.split(".");
  const expected = Buffer.from(signature(payload, secret));
  const actual = Buffer.from(received);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.expires <= Math.floor(now / 1000)) return null;
  return parsed.data;
}
