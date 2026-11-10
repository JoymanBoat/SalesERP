import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw, getWorkspace } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: queryRaw },
}));

vi.mock("@/lib/workspace", () => ({ getWorkspace }));

import { MembershipRole, Prisma } from "@prisma/client";
import { GET } from "./route";

describe("GET /reports/supplier-invoice-aging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00.000Z"));
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1", currency: "GHS", timezone: "Africa/Accra" },
      store: { id: "store-1", name: "Accra Central" },
      membership: { role: MembershipRole.ACCOUNTANT },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports the scoped aging summary with exact total and spreadsheet-safe supplier names", async () => {
    queryRaw.mockResolvedValue([{
      supplierId: "supplier-1",
      supplierName: "=HYPERLINK(\"https://example.com\")",
      undatedCount: 0,
      undatedBalance: "0",
      currentCount: 1,
      currentBalance: "12.35",
      overdue1To30Count: 0,
      overdue1To30Balance: "0",
      overdue31To60Count: 0,
      overdue31To60Balance: "0",
      overdue61PlusCount: 0,
      overdue61PlusBalance: "0",
    }]);

    const response = await GET(new Request("http://localhost/reports/supplier-invoice-aging"));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("supplier-invoice-aging-2026-11-05.csv");
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"Accra Central","2026-11-05","0","0","1","12.35"');
    expect(csv).toContain('"Total","Accra Central","2026-11-05","0","0.00","1","12.35"');

    const query = queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toContain("org-1");
    expect(query.values).toContain("store-1");
    expect(query.values).toContainEqual(new Date("2026-11-05T00:00:00.000Z"));
  });

  it("exports invoice-level payment, credit, balance and undated invoice details", async () => {
    queryRaw.mockResolvedValue([{
      supplierName: "Supplier One",
      purchaseOrderNumber: 14,
      invoiceNumber: "=INV-15",
      invoiceDate: "2026-10-01",
      dueDate: null,
      daysOverdue: null,
      invoiceAmount: "100.00",
      payments: "35.00",
      credits: "5.00",
      balance: "60.00",
    }]);

    const response = await GET(new Request(
      "http://localhost/reports/supplier-invoice-aging?detail=invoices",
    ));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("supplier-invoice-aging-details-2026-11-05.csv");
    expect(csv).toContain('"14","\'=INV-15","2026-10-01","","","100.00","35.00","5.00","60.00"');
    expect(csv).toContain('"Total","Accra Central","","1 invoices","","","","100.00","35.00","5.00","60.00"');

    const query = queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toContain("org-1");
    expect(query.values).toContain("store-1");
    expect(query.values).toContainEqual(new Date("2026-11-05T00:00:00.000Z"));
  });

  it("denies cashier access before querying invoice data", async () => {
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1", currency: "GHS", timezone: "Africa/Accra" },
      store: { id: "store-1", name: "Accra Central" },
      membership: { role: MembershipRole.CASHIER },
    });

    const response = await GET(new Request("http://localhost/reports/supplier-invoice-aging"));

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
