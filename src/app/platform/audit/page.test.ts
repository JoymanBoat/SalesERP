import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requirePlatformAdmin, findEvents, audit } = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  findEvents: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/platform-admin", () => ({ requirePlatformAdmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: { platformAuditEvent: { create: audit, findMany: findEvents } },
}));

import PlatformAuditPage from "./page";

describe("platform audit log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePlatformAdmin.mockResolvedValue({ user: { id: "admin-1" } });
  });

  it("shows recorded events with navigation", async () => {
    findEvents.mockResolvedValue([{
      id: "event-1",
      action: "business_records.viewed",
      organizationId: "business-1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      actor: { user: { email: "admin@example.test" } },
    }]);
    const markup = renderToStaticMarkup(await PlatformAuditPage());
    expect(markup).toContain("business_records.viewed");
    expect(markup).toContain("2026-01-01T00:00:00.000Z");
    expect(markup).toContain("admin@example.test");
    expect(markup).toContain('href="/platform"');
    expect(audit).toHaveBeenCalledWith({ data: { actorId: "admin-1", action: "platform_audit.viewed" } });
  });

  it("does not fetch events when the audit write fails", async () => {
    audit.mockRejectedValue(new Error("Audit unavailable"));
    await expect(PlatformAuditPage()).rejects.toThrow("Audit unavailable");
    expect(findEvents).not.toHaveBeenCalled();
  });
});
