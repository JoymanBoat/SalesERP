import { beforeEach, describe, expect, it, vi } from "vitest";

const { findProducts, getWorkspace } = vi.hoisted(() => ({
  findProducts: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { product: { findMany: findProducts } },
}));

vi.mock("@/lib/workspace", () => ({ getWorkspace }));

import { Prisma } from "@prisma/client";
import { GET } from "./route";

function product(index: number, archived = false) {
  return {
    id: `product-${String(index).padStart(3, "0")}`,
    name: index === 0 ? "=HYPERLINK(\"https://example.com\")" : `Product ${index}`,
    description: null,
    brand: "Brand",
    category: { name: "Household" },
    archivedAt: archived ? new Date("2026-10-01T00:00:00.000Z") : null,
    variants: [{
      name: "Default",
      sku: `SKU-${index}`,
      barcode: null,
      unitPrice: new Prisma.Decimal("12.50"),
      costPrice: null,
      trackInventory: true,
      inventoryLevels: [{ quantity: 8, reorderPoint: 10 }],
    }],
  };
}

describe("GET /products/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      store: { id: "store-1" },
    });
  });

  it("streams keyset batches with store-specific stock and formula-safe CSV", async () => {
    findProducts
      .mockResolvedValueOnce(Array.from({ length: 200 }, (_, index) => product(index)))
      .mockResolvedValueOnce([product(200)]);

    const response = await GET(new Request("http://localhost/products/export?q=%20desk%20"));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("products-active.csv");
    expect(findProducts).toHaveBeenCalledTimes(2);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"product-000","\'=HYPERLINK(""https://example.com"")","","Brand","Household","Default","SKU-0","","12.5","","true","8","10","active"');
    expect(csv).toContain('"product-200","Product 200","","Brand","Household","Default","SKU-200","","12.5","","true","8","10","active"');
    expect(csv.split("\r\n")).toHaveLength(203);

    const firstQuery = findProducts.mock.calls[0][0];
    expect(firstQuery.where).toMatchObject({
      organizationId: "org-1",
      archivedAt: null,
      OR: expect.any(Array),
    });
    expect(firstQuery.take).toBe(200);
    expect(firstQuery.orderBy).toEqual({ id: "asc" });
    expect(firstQuery.include.variants.include.inventoryLevels).toEqual({
      where: { organizationId: "org-1", storeId: "store-1" },
      select: { quantity: true, reorderPoint: true },
      take: 1,
    });
    expect(firstQuery.where.OR).toEqual(expect.arrayContaining([
      { name: { contains: "desk", mode: "insensitive" } },
      { category: { name: { contains: "desk", mode: "insensitive" } } },
    ]));

    const secondQuery = findProducts.mock.calls[1][0];
    expect(secondQuery.where.id).toEqual({ gt: "product-199" });
  });

  it("exports archived status and zero stock when no store-level inventory is present", async () => {
    findProducts.mockResolvedValueOnce([{
      ...product(3, true),
      variants: [{ ...product(3, true).variants[0], inventoryLevels: [] }],
    }]);

    const response = await GET(new Request("http://localhost/products/export?status=archived"));
    const csv = await response.text();

    expect(response.headers.get("Content-Disposition")).toContain("products-archived.csv");
    expect(csv).toContain('"product-003","Product 3","","Brand","Household","Default","SKU-3","","12.5","","true","0","0","archived"');
    expect(findProducts.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1",
      archivedAt: { not: null },
    });
  });
});
