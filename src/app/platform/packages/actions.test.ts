import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, update, audit, transaction, revalidate } = vi.hoisted(() => ({
  authorize: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/platform-admin", () => ({ requirePlatformAdmin: authorize }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));

import { updatePackage } from "./actions";

function packageForm() {
  const form = new FormData();
  form.set("id", "starter");
  form.set("revision", "0");
  form.append("features", "pos");
  form.append("features", "inventory");
  form.set("maxStores", "1");
  form.set("maxStaff", "2");
  form.set("monthlyPrice", "30.50");
  form.set("annualPrice", "");
  return form;
}

describe("package configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ user: { id: "admin-1" } });
    update.mockResolvedValue({ count: 1 });
    audit.mockResolvedValue({});
    transaction.mockImplementation((fn) => fn({ subscriptionPackage: { updateMany: update }, platformAuditEvent: { create: audit } }));
  });

  it("authenticates, saves the configuration, and audits it transactionally", async () => {
    expect(await updatePackage({ status: "idle", message: "" }, packageForm())).toMatchObject({ status: "success" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "starter", revision: 0 },
      data: { features: ["pos", "inventory"], maxStores: 1, maxStaff: 2, monthlyPrice: "30.50", annualPrice: null, revision: { increment: 1 } },
    });
    expect(audit).toHaveBeenCalledWith({ data: {
      actorId: "admin-1", action: "subscription_package.updated",
      details: { packageId: "starter", features: ["pos", "inventory"], maxStores: 1, maxStaff: 2, monthlyPrice: "30.50", annualPrice: null },
    } });
    expect(revalidate).toHaveBeenCalledWith("/platform/packages");
  });

  it("rejects unauthorized and malformed requests without saving", async () => {
    authorize.mockRejectedValueOnce(new Error("DENIED"));
    await expect(updatePackage({ status: "idle", message: "" }, packageForm())).rejects.toThrow("DENIED");
    const form = packageForm();
    form.set("monthlyPrice", "-1");
    expect(await updatePackage({ status: "idle", message: "" }, form)).toMatchObject({ status: "error" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects stale changes and reports audit failure", async () => {
    update.mockResolvedValueOnce({ count: 0 });
    expect(await updatePackage({ status: "idle", message: "" }, packageForm())).toMatchObject({ status: "error", message: expect.stringContaining("changed") });
    expect(audit).not.toHaveBeenCalled();
    audit.mockRejectedValueOnce(new Error("Audit unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await updatePackage({ status: "idle", message: "" }, packageForm())).toMatchObject({ status: "error" });
    expect(revalidate).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("rejects unknown and duplicate features and invalid limits", async () => {
    for (const [field, value] of [["features", "unknown"], ["features", "pos"], ["maxStores", "0"], ["annualPrice", "1.234"]]) {
      const form = packageForm();
      form.append(field, value);
      if (field !== "features") form.set(field, value);
      expect(await updatePackage({ status: "idle", message: "" }, form)).toMatchObject({ status: "error" });
    }
    expect(transaction).not.toHaveBeenCalled();
  });
});
