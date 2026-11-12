import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  membership: vi.fn(),
  registers: vi.fn(),
  subscription: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMembership: { findFirst: mocks.membership },
    posRegister: { findMany: mocks.registers },
    organizationSubscription: { findUnique: mocks.subscription },
  },
}));
vi.mock("@/lib/store-access", () => ({ getAccessibleStores: (_role: string, stores: unknown[]) => stores }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));

import { getMutationWorkspace, getWorkspace } from "./workspace";

const subscriptionRecord = {
  kind: "PAID",
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  packageId: "starter",
  package: { id: "starter", name: "Starter", features: ["pos"], maxStores: 1, maxStaff: 2 },
};

describe("workspace subscription access", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1", name: "Owner" }, revoked: false });
    mocks.membership.mockImplementation(({ where }) => {
      if (where.organizationId !== undefined && where.organizationId !== "org-1") return null;
      return {
        id: "membership-1", organizationId: "org-1", userId: "user-1", role: "OWNER",
        storeAssignments: [],
        organization: { id: "org-1", name: "Shop", stores: [{ id: "store-1", active: true }] },
      };
    });
    mocks.registers.mockResolvedValue([{ id: "register-1", name: "Main", code: "MAIN" }]);
    mocks.subscription.mockResolvedValue(null);
    mocks.cookies.mockResolvedValue({ get: () => undefined });
  });

  it("preserves existing unrestricted access and allows active legacy changes", async () => {
    const workspace = await getWorkspace({ feature: "reports", operation: "change" });
    expect(workspace.subscription).toEqual({ kind: "legacy" });
    expect(workspace.store.id).toBe("store-1");
  });

  it("blocks viewing features excluded from a paid plan", async () => {
    mocks.subscription.mockResolvedValue(subscriptionRecord);
    await expect(getWorkspace({ feature: "reports", operation: "view" }))
      .rejects.toThrow("REDIRECT:/subscription?reason=feature&feature=reports");
  });

  it("allows reads but blocks all changes after the subscription expires", async () => {
    mocks.subscription.mockResolvedValue({ ...subscriptionRecord, expiresAt: new Date("2020-01-01T00:00:00.000Z") });
    await expect(getWorkspace({ feature: "reports", operation: "view" })).resolves.toMatchObject({
      subscription: { kind: "paid" },
    });
    await expect(getWorkspace({ operation: "change" })).rejects.toThrow("REDIRECT:/subscription?reason=expired");
  });

  it("rejects malformed package configuration rather than granting access", async () => {
    mocks.subscription.mockResolvedValue({
      ...subscriptionRecord,
      package: { ...subscriptionRecord.package, features: ["unknown"] },
    });
    await expect(getWorkspace({ feature: "pos", operation: "view" })).rejects.toThrow();
  });

  it("binds mutations to the submitting organization's validated membership", async () => {
    const formData = new FormData();
    formData.set("workspaceOrganizationId", "org-2");
    mocks.cookies.mockResolvedValue({
      get: (name: string) => name === "saleserp-organization-id" ? { value: "org-1" } : undefined,
    });
    mocks.membership.mockImplementation(({ where }) => where.organizationId === "org-2"
      ? {
          id: "membership-2", organizationId: "org-2", userId: "user-1", role: "OWNER",
          storeAssignments: [],
          organization: { id: "org-2", name: "Second shop", stores: [{ id: "store-2", active: true }] },
        }
      : null);

    await expect(getMutationWorkspace(formData, { operation: "change" })).resolves.toMatchObject({
      organization: { id: "org-2" },
      membership: { id: "membership-2" },
    });
    expect(mocks.membership).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", organizationId: "org-2" },
    }));
  });

  it("rejects missing and revoked organization context instead of falling back to another business", async () => {
    await expect(getMutationWorkspace(new FormData(), { operation: "change" }))
      .rejects.toThrow("REDIRECT:/dashboard?workspaceError=stale");
    const formData = new FormData();
    formData.set("workspaceOrganizationId", "org-revoked");
    await expect(getMutationWorkspace(formData, { operation: "change" }))
      .rejects.toThrow("REDIRECT:/dashboard?workspaceError=unavailable");
    await expect(getWorkspace({ organizationId: "", operation: "view" }))
      .rejects.toThrow("REDIRECT:/dashboard?workspaceError=unavailable");
  });

  it("falls back to an active membership when the selected organization was revoked", async () => {
    mocks.cookies.mockResolvedValue({ get: (name: string) => name === "saleserp-organization-id" ? { value: "org-revoked" } : undefined });
    await expect(getWorkspace({ operation: "view" })).resolves.toMatchObject({
      organization: { id: "org-1" },
    });
    expect(mocks.membership).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { userId: "user-1" },
    }));
  });
});
