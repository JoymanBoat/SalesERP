export const SUBSCRIPTION_FEATURES = [
  "pos",
  "inventory",
  "customers",
  "suppliers",
  "purchasing",
  "reports",
  "promotions",
  "giftCards",
] as const;

export type SubscriptionFeature = (typeof SUBSCRIPTION_FEATURES)[number];
export type SubscriptionPackage = {
  name: string;
  features: readonly SubscriptionFeature[];
  maxStores: number | null;
  maxStaff: number | null;
};

export type Subscription =
  | { kind: "legacy" }
  | { kind: "trial"; expiresAt: Date }
  | { kind: "paid"; expiresAt: Date; package: SubscriptionPackage };

export const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function trialExpiresAt(start: Date): Date {
  if (!Number.isFinite(start.getTime())) throw new TypeError("Invalid trial start date.");
  return new Date(start.getTime() + TRIAL_DURATION_MS);
}

export function addSubscriptionBillingPeriod(start: Date, period: "MONTHLY" | "ANNUAL"): Date {
  if (!Number.isFinite(start.getTime())) throw new TypeError("Invalid subscription period start.");
  const result = new Date(start);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + (period === "MONTHLY" ? 1 : 12));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function subscriptionIsReadOnly(subscription: Subscription, now: Date): boolean {
  if (!Number.isFinite(now.getTime())) throw new TypeError("Invalid current date.");
  if (subscription.kind === "legacy") return false;
  const expiry = subscription.expiresAt.getTime();
  if (!Number.isFinite(expiry)) throw new TypeError("Invalid subscription expiry.");
  return now.getTime() >= expiry;
}

export function canUseSubscriptionFeature(
  subscription: Subscription,
  feature: SubscriptionFeature,
  operation: "view" | "change",
  now: Date,
): boolean {
  const readOnly = subscriptionIsReadOnly(subscription, now);
  if (readOnly) return operation === "view";
  return subscription.kind !== "paid" || subscription.package.features.includes(feature);
}

export function subscriptionLimitReached(
  subscription: Subscription,
  resource: "stores" | "staff",
  currentCount: number,
  now: Date,
): boolean {
  if (!Number.isSafeInteger(currentCount) || currentCount < 0) throw new TypeError("Invalid resource count.");
  if (subscriptionIsReadOnly(subscription, now)) return true;
  if (subscription.kind !== "paid") return false;
  const limit = resource === "stores" ? subscription.package.maxStores : subscription.package.maxStaff;
  if (limit === null) return false;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Invalid subscription limit.");
  return currentCount >= limit;
}
