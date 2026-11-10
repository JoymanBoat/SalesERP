import { describe, expect, it } from "vitest";

import {
  addSubscriptionBillingPeriod,
  canUseSubscriptionFeature,
  subscriptionIsReadOnly,
  subscriptionLimitReached,
  trialExpiresAt,
  type Subscription,
} from "./subscription-policy";

const start = new Date("2026-01-15T12:00:00.000Z");
const expiry = new Date("2026-02-14T12:00:00.000Z");
const beforeExpiry = new Date(expiry.getTime() - 1);
const starter: Subscription = {
  kind: "paid",
  expiresAt: expiry,
  package: { name: "Starter", features: ["pos", "inventory", "customers"], maxStores: 1, maxStaff: 2 },
};

describe("subscription policy", () => {
  it("uses an exact 30-day trial and expires at the boundary", () => {
    expect(trialExpiresAt(start)).toEqual(expiry);
    const trial: Subscription = { kind: "trial", expiresAt: expiry };
    expect(subscriptionIsReadOnly(trial, beforeExpiry)).toBe(false);
    expect(subscriptionIsReadOnly(trial, expiry)).toBe(true);
    expect(canUseSubscriptionFeature(trial, "giftCards", "change", beforeExpiry)).toBe(true);
    expect(canUseSubscriptionFeature(trial, "pos", "change", expiry)).toBe(false);
    expect(canUseSubscriptionFeature(trial, "pos", "view", expiry)).toBe(true);
  });

  it("adds calendar billing periods and clamps month-end dates", () => {
    expect(addSubscriptionBillingPeriod(new Date("2026-01-31T12:15:00.000Z"), "MONTHLY"))
      .toEqual(new Date("2026-02-28T12:15:00.000Z"));
    expect(addSubscriptionBillingPeriod(new Date("2024-02-29T12:15:00.000Z"), "ANNUAL"))
      .toEqual(new Date("2025-02-28T12:15:00.000Z"));
    expect(() => addSubscriptionBillingPeriod(new Date("invalid"), "MONTHLY")).toThrow(TypeError);
  });

  it("preserves unrestricted access for existing businesses", () => {
    const legacy: Subscription = { kind: "legacy" };
    expect(canUseSubscriptionFeature(legacy, "reports", "change", expiry)).toBe(true);
    expect(subscriptionLimitReached(legacy, "stores", 100, expiry)).toBe(false);
  });

  it("applies package features and limits to active paid businesses", () => {
    expect(canUseSubscriptionFeature(starter, "pos", "view", beforeExpiry)).toBe(true);
    expect(canUseSubscriptionFeature(starter, "purchasing", "view", beforeExpiry)).toBe(false);
    expect(canUseSubscriptionFeature(starter, "reports", "change", beforeExpiry)).toBe(false);
    expect(subscriptionLimitReached(starter, "stores", 0, beforeExpiry)).toBe(false);
    expect(subscriptionLimitReached(starter, "stores", 1, beforeExpiry)).toBe(true);
    expect(subscriptionLimitReached(starter, "staff", 2, beforeExpiry)).toBe(true);
  });

  it("allows viewing historical data but blocks changes after expiry", () => {
    expect(canUseSubscriptionFeature(starter, "reports", "view", expiry)).toBe(true);
    expect(canUseSubscriptionFeature(starter, "pos", "change", expiry)).toBe(false);
    expect(subscriptionLimitReached(starter, "stores", 0, expiry)).toBe(true);
  });

  it("rejects invalid dates and limits rather than silently allowing access", () => {
    expect(() => trialExpiresAt(new Date("invalid"))).toThrow(TypeError);
    expect(() => subscriptionIsReadOnly(starter, new Date("invalid"))).toThrow(TypeError);
    expect(() => subscriptionIsReadOnly({ kind: "trial", expiresAt: new Date("invalid") }, start)).toThrow(TypeError);
    expect(() => subscriptionLimitReached(starter, "staff", -1, start)).toThrow(TypeError);
    const invalid: Subscription = { ...starter, package: { ...starter.package, maxStores: 0 } };
    expect(() => subscriptionLimitReached(invalid, "stores", 0, start)).toThrow(TypeError);
  });
});
