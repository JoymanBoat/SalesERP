import { Prisma } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), organization: vi.fn(), packages: vi.fn(), payments: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/platform-admin", () => ({ requirePlatformAdmin: mocks.authorize }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  organization: { findUnique: mocks.organization },
  subscriptionPackage: { findMany: mocks.packages },
  subscriptionPayment: { findMany: mocks.payments },
  platformAuditEvent: { create: mocks.audit },
} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

import SubscriptionPaymentsPage from "./page";

const organizationId = "clh1p2s3t0000qwertyuiopas";
const params = Promise.resolve({ organizationId });

describe("subscription payment page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ user: { id: "admin-1" } });
    mocks.organization.mockResolvedValue({ id: organizationId, name: "Shop", timezone: "Africa/Accra", subscription: null });
    mocks.packages.mockResolvedValue([{ id: "starter", name: "Starter" }]);
    mocks.payments.mockResolvedValue([{
      id: "payment-1", packageName: "Starter", billingPeriod: "MONTHLY", amount: new Prisma.Decimal("50.25"),
      currency: "GHS", paidOn: new Date("2026-01-02T00:00:00Z"), createdAt: new Date("2026-01-03T00:00:00Z"), reference: "REF-123",
      voidedAt: null, voidReason: null, activatedAt: null, activatedBy: null,
      recordedBy: { user: { email: "admin@example.test" } }, voidedBy: null,
    }]);
    mocks.audit.mockResolvedValue({});
  });

  it("displays subscription controls and payment history", async () => {
    const markup = renderToStaticMarkup(await SubscriptionPaymentsPage({ params }));
    expect(markup).toContain("REF-123");
    expect(markup).toContain("50.25");
    expect(markup).toContain("Legacy access");
    expect(markup).toContain("Start 30-day trial");
    expect(markup).toContain("Activate paid plan");
    expect(markup).toContain("app does not collect or verify funds");
    expect(mocks.audit).toHaveBeenCalledWith({ data: { actorId: "admin-1", organizationId, action: "subscription_payments.viewed" } });
  });

  it("does not return records when authorization or audit fails", async () => {
    mocks.authorize.mockRejectedValueOnce(new Error("DENIED"));
    await expect(SubscriptionPaymentsPage({ params })).rejects.toThrow("DENIED");
    expect(mocks.organization).not.toHaveBeenCalled();
    mocks.audit.mockRejectedValueOnce(new Error("Audit unavailable"));
    await expect(SubscriptionPaymentsPage({ params })).rejects.toThrow("Audit unavailable");
  });
});
