import { beforeEach, describe, expect, it } from "vitest";

import { clearLoginFailures, isLoginBlocked, recordLoginFailure, resetLoginThrottleForTests } from "./login-throttle";

describe("login throttle", () => {
  beforeEach(resetLoginThrottleForTests);

  it("blocks an email after repeated failures and unblocks after the window", () => {
    const start = 1_000_000;
    for (let index = 0; index < 8; index += 1) {
      expect(isLoginBlocked("a@example.com", start)).toBe(false);
      recordLoginFailure("a@example.com", start);
    }
    expect(isLoginBlocked("a@example.com", start)).toBe(true);
    expect(isLoginBlocked("b@example.com", start)).toBe(false);
    expect(isLoginBlocked("a@example.com", start + 16 * 60 * 1000)).toBe(false);
  });

  it("clears failures after a successful sign-in", () => {
    for (let index = 0; index < 8; index += 1) recordLoginFailure("a@example.com");
    clearLoginFailures("a@example.com");
    expect(isLoginBlocked("a@example.com")).toBe(false);
  });
});
