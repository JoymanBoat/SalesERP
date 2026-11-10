import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, getWorkspace } = vi.hoisted(() => ({
  findMany: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findMany },
  },
}));

vi.mock("@/lib/workspace", () => ({
  getWorkspace,
}));

import { MembershipRole } from "@prisma/client";
import { GET } from "./route";

describe("GET /audit-logs/export", () => {
  beforeEach(() => {
    findMany.mockReset();
    getWorkspace.mockReset();
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
    });
  });

  it("exports filtered organization events in bounded batches with safe CSV cells", async () => {
    findMany
      .mockResolvedValueOnce([{
        id: "log-2",
        createdAt: new Date("2026-11-05T10:00:00.000Z"),
        action: "=HYPERLINK(\"https://example.com\")",
        entityType: "Product",
        entityId: "product-1",
        details: { sku: "SKU-1" },
        actor: { name: "Ama Mensah", email: "ama@example.com" },
      }])
      .mockResolvedValueOnce([]);

    const response = await GET(new Request(
      "http://localhost/audit-logs/export?q=%20%3D%20HYPERLINK%20&action=product.created",
    ));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("audit-history.csv");
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"Ama Mensah"');
    expect(csv).toContain('"{""sku"":""SKU-1""}"');
    expect(getWorkspace).toHaveBeenCalledWith({ allowedRoles: [MembershipRole.OWNER], operation: "view" });

    const firstQuery = findMany.mock.calls[0][0];
    expect(firstQuery.where).toMatchObject({
      organizationId: "org-1",
      action: "product.created",
      OR: expect.any(Array),
    });
    expect(firstQuery.take).toBe(500);
    const secondQuery = findMany.mock.calls[1][0];
    expect(secondQuery.where.AND[1].OR).toEqual([
      { createdAt: { lt: new Date("2026-11-05T10:00:00.000Z") } },
      { createdAt: new Date("2026-11-05T10:00:00.000Z"), id: { lt: "log-2" } },
    ]);
  });
});
