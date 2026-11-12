import { beforeEach, describe, expect, it, vi } from "vitest";
import { MembershipRole, Prisma } from "@prisma/client";

const { transaction, getWorkspace, revalidatePath, findOwner, create, updateMany, audit } = vi.hoisted(() => ({
  transaction: vi.fn(), getWorkspace: vi.fn(), revalidatePath: vi.fn(), findOwner: vi.fn(), create: vi.fn(), updateMany: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace,
  getMutationWorkspace: (_formData: FormData, options: unknown) => getWorkspace(options),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { saveCategory } from "./actions";

const idle = { status: "idle" as const, message: "" };
const categoryId = "clh1p2s3t0000qwertyuiopas";
function form(name: string, id?: string) {
  const data = new FormData();
  data.set("name", name);
  if (id) data.set("categoryId", id);
  return data;
}

describe("saveCategory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspace.mockResolvedValue({ organization: { id: "org-1" }, membership: { role: MembershipRole.OWNER, userId: "user-1" } });
    findOwner.mockResolvedValue({ id: "membership-1" });
    create.mockResolvedValue({ id: categoryId });
    updateMany.mockResolvedValue({ count: 1 });
    transaction.mockImplementation(async (callback) => callback({
      organizationMembership: { findFirst: findOwner },
      category: { create, updateMany },
      auditLog: { create: audit },
    }));
  });

  it("creates an organization-scoped category and audit record", async () => {
    expect(await saveCategory(idle, form(" Beverages "))).toEqual({ status: "success", message: "Category added." });
    expect(create).toHaveBeenCalledWith({ data: { organizationId: "org-1", name: "Beverages" }, select: { id: true } });
    expect(audit).toHaveBeenCalledWith({ data: expect.objectContaining({ organizationId: "org-1", actorId: "user-1", action: "category.created", entityId: categoryId }) });
    expect(revalidatePath).toHaveBeenCalledWith("/products");
  });

  it("renames only a category in the current organization", async () => {
    expect(await saveCategory(idle, form("Drinks", categoryId))).toEqual({ status: "success", message: "Category updated." });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: categoryId, organizationId: "org-1" }, data: { name: "Drinks" } });
    expect(audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "category.updated" }) });
    updateMany.mockResolvedValue({ count: 0 });
    expect((await saveCategory(idle, form("Drinks", categoryId))).message).toContain("no longer available");
  });

  it("rejects non-owners and revoked owner access", async () => {
    getWorkspace.mockResolvedValueOnce({ organization: { id: "org-1" }, membership: { role: MembershipRole.MANAGER, userId: "user-1" } });
    expect((await saveCategory(idle, form("Tea"))).message).toContain("Only an organization owner");
    expect(transaction).not.toHaveBeenCalled();
    findOwner.mockResolvedValue(null);
    expect((await saveCategory(idle, form("Tea"))).message).toContain("no longer available");
    expect(create).not.toHaveBeenCalled();
  });

  it("reports duplicates and invalid names", async () => {
    expect((await saveCategory(idle, form("   "))).status).toBe("error");
    expect(transaction).not.toHaveBeenCalled();
    transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Duplicate", { code: "P2002", clientVersion: "test" }));
    expect((await saveCategory(idle, form("Tea"))).message).toContain("already exists");
  });
});
