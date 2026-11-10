import { MembershipRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  canManageCatalog,
  canManageCustomers,
  canManageOrganizationMembers,
  canManagePricing,
  canManageStores,
  canManageSupplierInvoices,
  canManageSuppliers,
  canOperateRegister,
} from "./permissions";
import {
  addOrganizationMemberSchema,
  removeOrganizationMemberSchema,
  organizationMemberRegistersSchema,
  posRegisterInputSchema,
  updateOrganizationMemberRoleSchema,
} from "./validation";

describe("organization employee access", () => {
  const membershipId = "clh1p2s3t0000qwertyuiopas";

  it("normalizes email and accepts assignable organization roles", () => {
    const result = addOrganizationMemberSchema.safeParse({
      email: "  EMPLOYEE@EXAMPLE.COM ",
      role: "INVENTORY_MANAGER",
      storeIds: ["clh1p2s3t0001qwertyuiopas"],
      registerIds: ["clh1p2s3t0002qwertyuiopas"],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("employee@example.com");
    expect(addOrganizationMemberSchema.safeParse({
      email: "employee@example.com",
      role: "OWNER",
      storeIds: ["clh1p2s3t0001qwertyuiopas"],
      registerIds: [],
    }).success).toBe(false);
    expect(addOrganizationMemberSchema.safeParse({
      email: "not-an-email",
      role: "CASHIER",
      storeIds: ["clh1p2s3t0001qwertyuiopas"],
      registerIds: [],
    }).success).toBe(false);
    expect(addOrganizationMemberSchema.safeParse({
      email: "employee@example.com",
      role: "CASHIER",
      storeIds: [],
      registerIds: [],
    }).success).toBe(false);
  });

  it("validates register assignments and normalizes register codes", () => {
    const registerId = "clh1p2s3t0002qwertyuiopas";
    expect(organizationMemberRegistersSchema.safeParse({ membershipId, registerIds: [registerId] }).success).toBe(true);
    expect(organizationMemberRegistersSchema.safeParse({ membershipId, registerIds: [registerId, registerId] }).success).toBe(false);
    expect(posRegisterInputSchema.safeParse({ name: "Front Counter", code: "front-1" }).success).toBe(true);
    const result = posRegisterInputSchema.safeParse({ name: "Front Counter", code: "front-1" });
    expect(result.success && result.data.code).toBe("FRONT-1");
    expect(posRegisterInputSchema.safeParse({ name: "F", code: "FRONT" }).success).toBe(false);
  });

  it("validates membership identifiers and prevents assigning owner through role updates", () => {
    expect(updateOrganizationMemberRoleSchema.safeParse({
      membershipId,
      role: "MANAGER",
    }).success).toBe(true);
    expect(updateOrganizationMemberRoleSchema.safeParse({
      membershipId,
      role: "OWNER",
    }).success).toBe(false);
    expect(removeOrganizationMemberSchema.safeParse({ membershipId }).success).toBe(true);
    expect(removeOrganizationMemberSchema.safeParse({ membershipId: "invalid" }).success).toBe(false);
  });

  it("restricts employee access management to owners", () => {
    for (const role of Object.values(MembershipRole)) {
      expect(canManageOrganizationMembers(role)).toBe(role === MembershipRole.OWNER);
    }
  });

  it("keeps the complete role-permission matrix least-privilege", () => {
    const expected: Record<MembershipRole, boolean[]> = {
      [MembershipRole.OWNER]: [true, true, true, true, true, true, true, true],
      [MembershipRole.MANAGER]: [true, true, true, true, false, false, true, true],
      [MembershipRole.CASHIER]: [false, true, false, false, false, false, true, false],
      [MembershipRole.INVENTORY_MANAGER]: [true, false, true, false, false, false, false, false],
      [MembershipRole.ACCOUNTANT]: [false, false, false, true, false, false, false, false],
      [MembershipRole.CUSTOMER_SUPPORT]: [false, true, false, false, false, false, false, false],
    };

    for (const role of Object.values(MembershipRole)) {
      expect([
        canManageCatalog(role),
        canManageCustomers(role),
        canManageSuppliers(role),
        canManageSupplierInvoices(role),
        canManageOrganizationMembers(role),
        canManageStores(role),
        canOperateRegister(role),
        canManagePricing(role),
      ]).toEqual(expected[role]);
    }
  });
});
