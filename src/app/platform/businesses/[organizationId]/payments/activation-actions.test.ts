import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  transaction: vi.fn(),
  revalidate: vi.fn(),
  lock: vi.fn(),
  findSubscription: vi.fn(),
  createSubscription: vi.fn(),
  upsertSubscription: vi.fn(),
  findPayment: vi.fn(),
  activatePayment: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/platform-admin", () => ({ requirePlatformAdmin: mocks.authorize }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { activateSubscription } from "./actions";

const organizationId = "clh1p2s3t0000qwertyuiopas";
const paymentId = "clh1p2s3t0000qwertyuiopay";
const initial = { status: "idle" as const, message: "" };

function activationForm(kind: "TRIAL" | "PAID") {
  const form = new FormData();
  form.set("organizationId", organizationId);
  form.set("kind", kind);
  if (kind === "PAID") form.set("paymentId", paymentId);
  return form;
}

describe("platform subscription activation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-31T12:15:00.000Z"));
    mocks.authorize.mockResolvedValue({ user: { id: "admin-1" } });
    mocks.lock.mockResolvedValue([{ id: organizationId }]);
    mocks.findSubscription.mockResolvedValue(null);
    mocks.createSubscription.mockResolvedValue({});
    mocks.upsertSubscription.mockResolvedValue({});
    mocks.findPayment.mockResolvedValue({
      id: paymentId, packageId: "starter", packageName: "Starter", billingPeriod: "MONTHLY",
      amount: new Prisma.Decimal("50.25"), reference: "REF-123",
    });
    mocks.activatePayment.mockResolvedValue({ count: 1 });
    mocks.audit.mockResolvedValue({});
    mocks.transaction.mockImplementation((fn) => fn({
      $queryRaw: mocks.lock,
      organizationSubscription: {
        findUnique: mocks.findSubscription,
        create: mocks.createSubscription,
        upsert: mocks.upsertSubscription,
      },
      subscriptionPayment: { findFirst: mocks.findPayment, updateMany: mocks.activatePayment },
      platformAuditEvent: { create: mocks.audit },
    }));
  });

  it("starts one 30-day trial and audits the exact access period", async () => {
    expect(await activateSubscription(initial, activationForm("TRIAL"))).toMatchObject({
      status: "success",
      message: expect.stringContaining("30-day trial is active"),
    });
    expect(mocks.createSubscription).toHaveBeenCalledWith({
      data: {
        organizationId, kind: "TRIAL",
        expiresAt: new Date("2026-03-02T12:15:00.000Z"),
        packageId: null,
      },
    });
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "admin-1", organizationId, action: "subscription.trial_activated",
    }) });
    expect(mocks.revalidate).toHaveBeenCalledWith(`/platform/businesses/${organizationId}/payments`);
  });

  it("does not allow a second trial", async () => {
    mocks.findSubscription.mockResolvedValue({ expiresAt: new Date("2026-02-01T00:00:00.000Z") });
    expect(await activateSubscription(initial, activationForm("TRIAL"))).toMatchObject({
      status: "error", message: expect.stringContaining("already exists"),
    });
    expect(mocks.createSubscription).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("activates an unused payment for one calendar month and audits its source", async () => {
    expect(await activateSubscription(initial, activationForm("PAID"))).toMatchObject({
      status: "success", message: expect.stringContaining("paid subscription is active"),
    });
    expect(mocks.findPayment).toHaveBeenCalledWith({
      where: { id: paymentId, organizationId, voidedAt: null, activatedAt: null },
      select: { id: true, packageId: true, packageName: true, billingPeriod: true, amount: true, reference: true },
    });
    expect(mocks.activatePayment).toHaveBeenCalledWith({
      where: { id: paymentId, organizationId, voidedAt: null, activatedAt: null },
      data: { activatedAt: new Date("2026-01-31T12:15:00.000Z"), activatedById: "admin-1" },
    });
    expect(mocks.upsertSubscription).toHaveBeenCalledWith({
      where: { organizationId },
      create: { organizationId, kind: "PAID", packageId: "starter", expiresAt: new Date("2026-02-28T12:15:00.000Z") },
      update: { kind: "PAID", packageId: "starter", expiresAt: new Date("2026-02-28T12:15:00.000Z") },
    });
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "admin-1", organizationId, action: "subscription.paid_activated",
      details: expect.objectContaining({ paymentId, reference: "REF-123", amount: "50.25" }),
    }) });
  });

  it("extends from an unexpired term and rejects reused or voided payments", async () => {
    mocks.findSubscription.mockResolvedValue({ expiresAt: new Date("2026-02-10T00:00:00.000Z") });
    await activateSubscription(initial, activationForm("PAID"));
    expect(mocks.upsertSubscription.mock.calls[0][0].create.expiresAt).toEqual(new Date("2026-03-10T00:00:00.000Z"));

    mocks.findPayment.mockResolvedValueOnce(null);
    expect(await activateSubscription(initial, activationForm("PAID"))).toMatchObject({ status: "error" });
    expect(mocks.upsertSubscription).toHaveBeenCalledTimes(1);
  });

  it("validates the target and reports transactional failures", async () => {
    const badForm = activationForm("PAID");
    badForm.set("paymentId", "missing");
    expect(await activateSubscription(initial, badForm)).toMatchObject({ status: "error" });
    expect(mocks.transaction).not.toHaveBeenCalled();

    mocks.lock.mockResolvedValueOnce([]);
    expect(await activateSubscription(initial, activationForm("TRIAL"))).toMatchObject({
      status: "error", message: expect.stringContaining("no longer available"),
    });
  });
});
