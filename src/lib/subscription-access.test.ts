import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

import { assertSubscriptionCapacity, getOrganizationSubscription, SubscriptionCapacityError } from "./subscription-access";

const now = new Date("2026-01-01T00:00:00Z");
function transaction(record: unknown, count = 0) {
  const findUnique = vi.fn().mockResolvedValue(record);
  const countStores = vi.fn().mockResolvedValue(count);
  const countMembers = vi.fn().mockResolvedValue(count);
  const tx = {
    organizationSubscription: { findUnique },
    store: { count: countStores },
    organizationMembership: { count: countMembers },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, findUnique, countStores, countMembers };
}
const starter = {
  kind: "PAID", expiresAt: new Date("2026-02-01T00:00:00Z"), packageId: "starter",
  package: { id: "starter", name: "Starter", features: ["pos", "inventory"], maxStores: 1, maxStaff: 2 },
};

describe("subscription capacity checks", () => {
  it("preserves legacy and active trial access without counting", async () => {
    for (const record of [null, { kind: "TRIAL", expiresAt: new Date("2026-02-01"), packageId: null }]) {
      const { tx, countStores, countMembers } = transaction(record);
      await assertSubscriptionCapacity(tx, "org", "stores", now);
      await assertSubscriptionCapacity(tx, "org", "staff", now);
      expect(countStores).not.toHaveBeenCalled();
      expect(countMembers).not.toHaveBeenCalled();
    }
  });

  it("counts active stores and all memberships, including owners", async () => {
    const stores = transaction(starter, 1);
    await expect(assertSubscriptionCapacity(stores.tx, "org", "stores", now)).rejects.toMatchObject({ reason: "stores" });
    expect(stores.countStores).toHaveBeenCalledWith({ where: { organizationId: "org", active: true } });
    const staff = transaction(starter, 2);
    await expect(assertSubscriptionCapacity(staff.tx, "org", "staff", now)).rejects.toMatchObject({ reason: "staff" });
    expect(staff.countMembers).toHaveBeenCalledWith({ where: { organizationId: "org" } });
    await expect(assertSubscriptionCapacity(transaction(starter, 1).tx, "org", "staff", now)).resolves.toBeUndefined();
  });

  it("rejects expired subscriptions at the exact boundary", async () => {
    const { tx, countMembers } = transaction({ ...starter, expiresAt: now });
    await expect(assertSubscriptionCapacity(tx, "org", "staff", now)).rejects.toMatchObject({ reason: "expired" });
    expect(countMembers).not.toHaveBeenCalled();
  });

  it("fails closed on missing packages or unknown features", async () => {
    await expect(getOrganizationSubscription(transaction({ ...starter, package: null }).tx, "org")).rejects.toThrow("Invalid paid subscription");
    await expect(getOrganizationSubscription(transaction({ ...starter, package: { ...starter.package, features: ["unknown"] } }).tx, "org")).rejects.toThrow();
    expect(new SubscriptionCapacityError("stores")).toBeInstanceOf(Error);
  });
});
