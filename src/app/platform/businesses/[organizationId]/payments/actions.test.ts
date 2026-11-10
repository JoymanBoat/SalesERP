import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), transaction: vi.fn(), revalidate: vi.fn(),
  organization: vi.fn(), selectedPackage: vi.fn(), create: vi.fn(), update: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/platform-admin", () => ({ requirePlatformAdmin: mocks.authorize }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { recordSubscriptionPayment, voidSubscriptionPayment } from "./actions";

const organizationId = "clh1p2s3t0000qwertyuiopas";
const paymentId = "clh1p2s3t0000qwertyuiopay";
const initial = { status: "idle" as const, message: "" };

function paymentForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({ organizationId, packageId: "starter", billingPeriod: "MONTHLY", amount: "50.25", reference: " ref-123 ", paidOn: "2026-01-02" })) form.set(key, value);
  return form;
}

function voidForm() {
  const form = new FormData();
  form.set("organizationId", organizationId);
  form.set("paymentId", paymentId);
  form.set("reason", "Incorrect payment entry");
  return form;
}

describe("subscription payment records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ user: { id: "admin-1" } });
    mocks.organization.mockResolvedValue({ id: organizationId });
    mocks.selectedPackage.mockResolvedValue({ name: "Starter" });
    mocks.create.mockResolvedValue({ id: paymentId });
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.audit.mockResolvedValue({});
    mocks.transaction.mockImplementation((fn) => fn({
      organization: { findUnique: mocks.organization },
      subscriptionPackage: { findUnique: mocks.selectedPackage },
      subscriptionPayment: { create: mocks.create, updateMany: mocks.update },
      platformAuditEvent: { create: mocks.audit },
    }));
  });

  it("records the payment and audit together without activation", async () => {
    expect(await recordSubscriptionPayment(initial, paymentForm())).toMatchObject({ status: "success", message: expect.stringContaining("No subscription was activated") });
    expect(mocks.create).toHaveBeenCalledWith({ data: {
      organizationId, packageId: "starter", packageName: "Starter", billingPeriod: "MONTHLY",
      amount: "50.25", currency: "GHS", reference: "REF-123",
      paidOn: new Date("2026-01-02T00:00:00Z"), recordedById: "admin-1",
    }, select: { id: true } });
    expect(mocks.audit).toHaveBeenCalledWith({ data: {
      actorId: "admin-1", organizationId, action: "subscription_payment.recorded",
      details: { paymentId, packageId: "starter", packageName: "Starter", billingPeriod: "MONTHLY", amount: "50.25", currency: "GHS", reference: "REF-123", paidOn: "2026-01-02" },
    } });
    expect(mocks.revalidate).toHaveBeenCalledWith(`/platform/businesses/${organizationId}/payments`);
  });

  it("rejects unauthorized users and invalid amounts, dates and package choices", async () => {
    mocks.authorize.mockRejectedValueOnce(new Error("DENIED"));
    await expect(recordSubscriptionPayment(initial, paymentForm())).rejects.toThrow("DENIED");
    for (const [field, value] of [["amount", "0"], ["amount", "1.234"], ["paidOn", "2026-02-30"], ["paidOn", "9999-12-31"], ["packageId", "unknown"], ["reference", " "]]) {
      const form = paymentForm();
      form.set(field, value);
      expect(await recordSubscriptionPayment(initial, form)).toMatchObject({ status: "error" });
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("reports duplicate references and audit errors rather than success", async () => {
    mocks.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "7" }));
    expect(await recordSubscriptionPayment(initial, paymentForm())).toMatchObject({ status: "error", message: expect.stringContaining("already recorded") });
    mocks.audit.mockRejectedValueOnce(new Error("Audit unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await recordSubscriptionPayment(initial, paymentForm())).toMatchObject({ status: "error" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("voids only the specified business's unvoided payment and audits the reason", async () => {
    expect(await voidSubscriptionPayment(initial, voidForm())).toMatchObject({ status: "success", message: expect.stringContaining("No money was refunded") });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: paymentId, organizationId, voidedAt: null, activatedAt: null },
      data: { voidedAt: expect.any(Date), voidedById: "admin-1", voidReason: "Incorrect payment entry" },
    });
    expect(mocks.audit).toHaveBeenCalledWith({ data: { actorId: "admin-1", organizationId, action: "subscription_payment.voided", details: { paymentId, reason: "Incorrect payment entry" } } });
  });

  it("rejects invalid voids and reports already voided records", async () => {
    const form = voidForm();
    form.set("reason", "bad");
    expect(await voidSubscriptionPayment(initial, form)).toMatchObject({ status: "error" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.update.mockResolvedValueOnce({ count: 0 });
    expect(await voidSubscriptionPayment(initial, voidForm())).toMatchObject({ status: "error", message: expect.stringContaining("already voided") });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
