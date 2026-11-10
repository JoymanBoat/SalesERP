import { beforeEach, describe, expect, it, vi } from "vitest";

const { findInvitation, transaction, hashPassword, hashToken } = vi.hoisted(() => ({
  findInvitation: vi.fn(),
  transaction: vi.fn(),
  hashPassword: vi.fn(),
  hashToken: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    employeeInvitation: { findFirst: findInvitation },
    $transaction: transaction,
  },
}));
vi.mock("bcryptjs", () => ({ default: { hash: hashPassword } }));
vi.mock("@/lib/auth-token", () => ({ hashAuthToken: hashToken }));

import { POST } from "./route";

function request() {
  return new Request("https://sales.example/api/auth/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: "A".repeat(43),
      name: "Ama Mensah",
      password: "a-new-secure-password",
    }),
  });
}

describe("POST /api/auth/invitations/accept", () => {
  const findLockedInvitation = vi.fn();
  const findUser = vi.fn();
  const findInviter = vi.fn();
  const findStores = vi.fn();
  const findRegisters = vi.fn();
  const createUser = vi.fn();
  const createMembership = vi.fn();
  const createStoreAssignments = vi.fn();
  const createRegisterAssignments = vi.fn();
  const createAuditLog = vi.fn();
  const deleteInvitation = vi.fn();
  const lockInvitation = vi.fn();
  const findSubscription = vi.fn();
  const countMembers = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    hashToken.mockReturnValue("hashed-token");
    hashPassword.mockResolvedValue("bcrypt-hash");
    findInvitation.mockResolvedValue({ id: "invite-1" });
    findLockedInvitation.mockResolvedValue({
      id: "invite-1",
      organizationId: "org-1",
      invitedById: "owner-1",
      email: "employee@example.com",
      role: "CASHIER",
      storeIds: ["store-1"],
      registerIds: ["register-1"],
    });
    findUser.mockResolvedValue(null);
    findInviter.mockResolvedValue({ id: "owner-membership" });
    findStores.mockResolvedValue([{ id: "store-1" }]);
    findRegisters.mockResolvedValue([{ id: "register-1", storeId: "store-1" }]);
    createUser.mockResolvedValue({ id: "user-1" });
    createMembership.mockResolvedValue({ id: "membership-1" });
    createStoreAssignments.mockResolvedValue({ count: 1 });
    createRegisterAssignments.mockResolvedValue({ count: 1 });
    createAuditLog.mockResolvedValue({});
    deleteInvitation.mockResolvedValue({});
    lockInvitation.mockResolvedValue([]);
    findSubscription.mockResolvedValue(null);
    countMembers.mockResolvedValue(1);
    transaction.mockImplementation(async (callback) => callback({
      $queryRaw: lockInvitation,
      employeeInvitation: {
        findFirst: findLockedInvitation,
        delete: deleteInvitation,
      },
      user: { findUnique: findUser, create: createUser },
      organizationMembership: { findFirst: findInviter, create: createMembership, count: countMembers },
      organizationSubscription: { findUnique: findSubscription },
      store: { findMany: findStores },
      posRegister: { findMany: findRegisters },
      organizationStoreAssignment: { createMany: createStoreAssignments },
      posRegisterAssignment: { createMany: createRegisterAssignments },
      auditLog: { create: createAuditLog },
    }));
  });

  it("rejects malformed or unavailable invitations before hashing a password", async () => {
    const invalidBody = await POST(new Request("https://sales.example/api/auth/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "bad", name: "A", password: "short" }),
    }));
    findInvitation.mockResolvedValue(null);
    const missingInvite = await POST(request());

    expect(invalidBody.status).toBe(400);
    expect(missingInvite.status).toBe(400);
    expect(hashPassword).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("creates the account, scoped membership, assignments, and audit entry atomically", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(createUser).toHaveBeenCalledWith({
      data: {
        name: "Ama Mensah",
        email: "employee@example.com",
        emailVerified: expect.any(Date),
        passwordHash: "bcrypt-hash",
      },
      select: { id: true },
    });
    expect(createMembership).toHaveBeenCalledWith({
      data: { organizationId: "org-1", userId: "user-1", role: "CASHIER" },
      select: { id: true },
    });
    expect(createStoreAssignments).toHaveBeenCalledWith({
      data: [{ organizationId: "org-1", membershipId: "membership-1", storeId: "store-1" }],
    });
    expect(createRegisterAssignments).toHaveBeenCalledWith({
      data: [{
        organizationId: "org-1",
        membershipId: "membership-1",
        storeId: "store-1",
        registerId: "register-1",
      }],
    });
    expect(deleteInvitation).toHaveBeenCalledWith({ where: { id: "invite-1" } });
  });

  it("does not grant access if any invited store assignment is no longer active", async () => {
    findStores.mockResolvedValue([]);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(createUser).not.toHaveBeenCalled();
    expect(createMembership).not.toHaveBeenCalled();
  });

  it("does not create another account for an email already in use", async () => {
    findUser.mockResolvedValue({ id: "existing-user" });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(createUser).not.toHaveBeenCalled();
    expect(createMembership).not.toHaveBeenCalled();
  });

  it("rejects invitations whose inviter no longer owns the organization", async () => {
    findInviter.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(createUser).not.toHaveBeenCalled();
    expect(createMembership).not.toHaveBeenCalled();
  });

  it("rechecks the staff limit at acceptance before creating an account", async () => {
    findSubscription.mockResolvedValue({
      kind: "PAID", expiresAt: new Date("2099-01-01"), packageId: "starter",
      package: { id: "starter", name: "Starter", features: ["pos"], maxStores: 1, maxStaff: 1 },
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("staff limit") });
    expect(createUser).not.toHaveBeenCalled();
  });
});
