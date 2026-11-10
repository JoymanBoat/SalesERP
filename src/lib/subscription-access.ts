import { z } from "zod";
import type { Prisma } from "@prisma/client";

import {
  SUBSCRIPTION_FEATURES, canUseSubscriptionFeature, subscriptionIsReadOnly, subscriptionLimitReached,
  type Subscription, type SubscriptionFeature,
} from "@/lib/subscription-policy";

const featuresSchema = z.array(z.enum(SUBSCRIPTION_FEATURES));
type SubscriptionReader = Pick<Prisma.TransactionClient, "organizationSubscription">;

export async function getOrganizationSubscription(
  transaction: SubscriptionReader,
  organizationId: string,
): Promise<Subscription> {
  const record = await transaction.organizationSubscription.findUnique({
    where: { organizationId },
    include: { package: true },
  });
  if (!record) return { kind: "legacy" };
  if (record.kind === "TRIAL") {
    if (record.packageId !== null) throw new Error("Invalid trial subscription configuration.");
    return { kind: "trial", expiresAt: record.expiresAt };
  }
  if (record.kind !== "PAID" || !record.package || record.packageId !== record.package.id) {
    throw new Error("Invalid paid subscription configuration.");
  }
  return {
    kind: "paid",
    expiresAt: record.expiresAt,
    package: {
      name: record.package.name,
      features: featuresSchema.parse(record.package.features),
      maxStores: record.package.maxStores,
      maxStaff: record.package.maxStaff,
    },
  };
}

export async function organizationCanUseFeature(
  client: SubscriptionReader,
  organizationId: string,
  feature: SubscriptionFeature,
  operation: "view" | "change",
  now: Date = new Date(),
) {
  const subscription = await getOrganizationSubscription(client, organizationId);
  return canUseSubscriptionFeature(subscription, feature, operation, now);
}

export class SubscriptionCapacityError extends Error {
  constructor(public readonly reason: "expired" | "stores" | "staff") {
    super(`Subscription capacity denied: ${reason}`);
  }
}

export function subscriptionCapacityMessage(error: SubscriptionCapacityError) {
  if (error.reason === "expired") return "The subscription has expired. Contact the platform administrator to renew access.";
  if (error.reason === "stores") return "The subscription's active store limit has been reached.";
  return "The subscription's staff limit has been reached. The owner is included in this limit.";
}

// The caller must hold the organization's row lock until its mutation commits.
export async function assertSubscriptionCapacity(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  resource: "stores" | "staff",
  now: Date = new Date(),
) {
  const subscription = await getOrganizationSubscription(transaction, organizationId);
  if (subscriptionIsReadOnly(subscription, now)) throw new SubscriptionCapacityError("expired");
  if (subscription.kind !== "paid") return;
  const count = resource === "stores"
    ? await transaction.store.count({ where: { organizationId, active: true } })
    : await transaction.organizationMembership.count({ where: { organizationId } });
  if (subscriptionLimitReached(subscription, resource, count, now)) throw new SubscriptionCapacityError(resource);
}
