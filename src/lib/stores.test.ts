import { MembershipRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { canManageStores } from "./permissions";
import { getAccessibleStores } from "./store-access";
import {
  organizationMemberStoresSchema,
  storeCreateSchema,
  storeSelectionSchema,
  storeStatusSchema,
  storeUpdateSchema,
} from "./validation";

describe("store setup validation and access", () => {
  const storeId = "clh1p2s3t0000qwertyuiopas";

  it("normalizes store codes and accepts optional addresses", () => {
    const result = storeCreateSchema.safeParse({
      name: "  Osu Branch ",
      code: " osu-1 ",
      address: " Oxford Street, Accra ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        name: "Osu Branch",
        code: "OSU-1",
        address: "Oxford Street, Accra",
      });
    }
    expect(storeCreateSchema.safeParse({
      name: "Osu",
      code: "OSU/1",
    }).success).toBe(false);
    expect(storeCreateSchema.safeParse({
      name: " ",
      code: "A",
    }).success).toBe(false);
  });

  it("validates update identifiers and store status inputs", () => {
    expect(storeUpdateSchema.safeParse({
      storeId,
      name: "Osu Branch",
      code: "OSU",
    }).success).toBe(true);
    expect(storeUpdateSchema.safeParse({
      storeId: "invalid",
      name: "Osu Branch",
      code: "OSU",
    }).success).toBe(false);
    expect(storeStatusSchema.safeParse({ storeId, active: "false" }).success).toBe(true);
    expect(storeStatusSchema.safeParse({ storeId, active: "inactive" }).success).toBe(false);
    expect(storeSelectionSchema.safeParse({ storeId }).success).toBe(true);
    expect(organizationMemberStoresSchema.safeParse({
      membershipId: storeId,
      storeIds: [storeId],
    }).success).toBe(true);
    expect(organizationMemberStoresSchema.safeParse({
      membershipId: storeId,
      storeIds: [storeId, storeId],
    }).success).toBe(false);
    expect(organizationMemberStoresSchema.safeParse({
      membershipId: storeId,
      storeIds: [],
    }).success).toBe(false);
  });

  it("limits store configuration to organization owners", () => {
    for (const role of Object.values(MembershipRole)) {
      expect(canManageStores(role)).toBe(role === MembershipRole.OWNER);
    }
  });

  it("limits staff to assigned active stores while owners can access every active store", () => {
    const activeStores = [
      { id: "store-1", name: "Accra" },
      { id: "store-2", name: "Tema" },
    ];

    expect(getAccessibleStores(MembershipRole.CASHIER, activeStores, ["store-2"])).toEqual([activeStores[1]]);
    expect(getAccessibleStores(MembershipRole.CASHIER, activeStores, [])).toEqual([]);
    expect(getAccessibleStores(MembershipRole.OWNER, activeStores, [])).toEqual(activeStores);
  });
});
