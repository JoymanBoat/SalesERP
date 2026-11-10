import { Prisma } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requirePlatformAdmin, findOrganization, audit } = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  findOrganization: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/platform-admin", () => ({ requirePlatformAdmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: findOrganization },
    platformAuditEvent: { create: audit },
  },
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

import PlatformBusinessPage from "./page";

const organizationId = "clh1p2s3t0000qwertyuiopas";
const params = Promise.resolve({ organizationId });

describe("platform business records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePlatformAdmin.mockResolvedValue({ user: { id: "admin-1" } });
    findOrganization.mockResolvedValue({
      id: organizationId,
      name: "Shop",
      timezone: "Africa/Accra",
      currency: "GHS",
      stores: [{ id: "store-1", name: "Main", active: true }],
      products: [{ id: "product-1", name: "Tea", archivedAt: null }],
      orders: [{ id: "order-1", number: 1, status: "PAID", currency: "GHS", total: new Prisma.Decimal("15"), createdAt: new Date("2026-01-01T00:00:00Z") }],
    });
  });

  it("requires platform access and records each view", async () => {
    const markup = renderToStaticMarkup(await PlatformBusinessPage({ params }));
    expect(markup).toContain("Shop");
    expect(markup).toContain("Tea");
    expect(audit).toHaveBeenCalledWith({ data: { actorId: "admin-1", organizationId, action: "business_records.viewed" } });
  });

  it("does not return records if the audit write fails", async () => {
    audit.mockRejectedValue(new Error("Audit unavailable"));
    await expect(PlatformBusinessPage({ params })).rejects.toThrow("Audit unavailable");
  });

  it("does not query data when authorization fails", async () => {
    requirePlatformAdmin.mockRejectedValue(new Error("DENIED"));
    await expect(PlatformBusinessPage({ params })).rejects.toThrow("DENIED");
    expect(findOrganization).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
