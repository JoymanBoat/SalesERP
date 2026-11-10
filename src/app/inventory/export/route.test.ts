import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw, getWorkspace } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: queryRaw },
}));

vi.mock("@/lib/workspace", () => ({ getWorkspace }));

import { Prisma } from "@prisma/client";
import { GET } from "./route";

function inventoryRow(index: number) {
  return {
    id: `level-${String(index).padStart(3, "0")}`,
    productName: index === 0 ? "=HYPERLINK(\"https://example.com\")" : `Product ${index}`,
    variantName: "Default",
    sku: `SKU-${index}`,
    barcode: null,
    quantity: 8,
    reserved: 3,
    reorderPoint: 10,
  };
}

describe("GET /inventory/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      store: { id: "store-1", name: "Accra Central" },
    });
  });

  it("streams keyset batches with the selected store, formula-safe cells, and available stock", async () => {
    queryRaw
      .mockResolvedValueOnce(Array.from({ length: 500 }, (_, index) => inventoryRow(index)))
      .mockResolvedValueOnce([inventoryRow(500)]);

    const response = await GET(new Request("http://localhost/inventory/export?q=%20SKU%20&status=low"));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("inventory-low.csv");
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"Accra Central","\'=HYPERLINK(""https://example.com"")","Default","SKU-0","","8","3","5","10","5","low stock"');
    expect(csv).toContain('"Accra Central","Product 500","Default","SKU-500","","8","3","5","10","5","low stock"');
    expect(csv.split("\r\n")).toHaveLength(503);

    const firstQuery = queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(firstQuery.values).toContain("org-1");
    expect(firstQuery.values).toContain("store-1");
    expect(firstQuery.values).toContain("SKU");
    expect(firstQuery.sql).toContain('level."quantity" > 0 AND level."quantity" <= level."reorderPoint"');
    expect(firstQuery.sql).toContain('product."archivedAt" IS NULL');

    const secondQuery = queryRaw.mock.calls[1][0] as Prisma.Sql;
    expect(secondQuery.values).toContain("level-499");
    expect(secondQuery.sql).toContain('level."id" >');
  });

  it("clamps over-reserved available quantity to zero and defaults unknown statuses to all", async () => {
    queryRaw.mockResolvedValueOnce([{
      ...inventoryRow(1),
      quantity: 1,
      reserved: 4,
      reorderPoint: 6,
    }]);

    const response = await GET(new Request("http://localhost/inventory/export?status=unexpected"));
    const csv = await response.text();

    expect(response.headers.get("Content-Disposition")).toContain("inventory-all.csv");
    expect(csv).toContain('"Accra Central","Product 1","Default","SKU-1","","1","4","0","6","6","low stock"');
    const query = queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.sql).not.toContain('level."quantity" > 0 AND');
    expect(query.sql).not.toContain('level."quantity" <= 0');
  });
});
