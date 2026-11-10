import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requirePlatformAdmin, findOrganizations, audit } = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  findOrganizations: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/platform-admin", () => ({ requirePlatformAdmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findMany: findOrganizations },
    platformAuditEvent: { create: audit },
  },
}));

import PlatformPage from "./page";

describe("platform business directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePlatformAdmin.mockResolvedValue({ user: { id: "admin-1" } });
  });

  it("shows business links, counts, navigation and the access limitation", async () => {
    findOrganizations.mockResolvedValue([{ id: "business-1", name: "Shop", _count: { stores: 2, memberships: 3 } }]);
    const markup = renderToStaticMarkup(await PlatformPage());
    expect(markup).toContain("Shop");
    expect(markup).toContain("/platform/businesses/business-1");
    expect(markup).toContain("2 stores");
    expect(markup).toContain("3 members");
    expect(markup).toContain("/platform/audit");
    expect(markup).toContain("package features and capacity limits are enforced");
    expect(audit).toHaveBeenCalledWith({ data: { actorId: "admin-1", action: "business_directory.viewed" } });
  });

  it("shows an empty state and refuses to render if audit logging fails", async () => {
    findOrganizations.mockResolvedValue([]);
    expect(renderToStaticMarkup(await PlatformPage())).toContain("No businesses to show yet.");
    audit.mockRejectedValue(new Error("Audit unavailable"));
    await expect(PlatformPage()).rejects.toThrow("Audit unavailable");
  });
});
