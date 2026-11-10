import { createHash, randomBytes } from "node:crypto";

export function createAuthToken() {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

export function hashAuthToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function authBaseUrl() {
  const value = process.env.AUTH_URL ?? "http://localhost:3000";
  const url = new URL(value);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("AUTH_URL must use HTTPS in production.");
  }
  return url;
}
