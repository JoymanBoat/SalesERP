import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("GET /reports/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00.000Z"));
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1", currency: "GHS", timezone: "Africa/Accra" },
      store: { id: "store-1" },
    });
    queryRaw.mockResolvedValue([
      { period: "2026-11-01", revenue: new Prisma.Decimal("150.25"), orderCount: 3n },
      { period: "2026-11-02", revenue: new Prisma.Decimal("0"), orderCount: 0n },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports store-period trend rows with safe CSV metadata", async () => {
    const response = await GET(new Request("http://localhost/reports/export?days=7"));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("sales-trend-7-days.csv");
    expect(csv).toContain('"Period","Net sales (GHS)","Paid orders"');
    expect(csv).toContain('"2026-11-01","150.25","3"');
    expect(csv).toContain('"2026-11-02","0","0"');

    const query = queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toContain("org-1");
    expect(query.values).toContain("store-1");
    expect(query.values).toContain("Africa/Accra");
    expect(query.values).toContain("day");
    expect(query.values).toContainEqual(new Date("2026-10-29T12:00:00.000Z"));
    expect(query.values).toContainEqual(new Date("2026-11-05T12:00:00.000Z"));
  });

  it("uses the default 30-day period for unsupported period inputs", async () => {
    const response = await GET(new Request("http://localhost/reports/export?days=365"));

    expect(response.headers.get("Content-Disposition")).toContain("sales-trend-30-days.csv");
    const query = queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toContain("week");
    expect(query.values).toContainEqual(new Date("2026-10-06T12:00:00.000Z"));
  });
});
