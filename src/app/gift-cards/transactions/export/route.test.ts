import { beforeEach, describe, expect, it, vi } from "vitest";

const { findTransactions, findGiftCard, findUsers, getWorkspace } = vi.hoisted(() => ({
  findTransactions: vi.fn(),
  findGiftCard: vi.fn(),
  findUsers: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    giftCardTransaction: { findMany: findTransactions },
    giftCard: { findFirst: findGiftCard },
    user: { findMany: findUsers },
  },
}));

vi.mock("@/lib/workspace", () => ({ getWorkspace }));
vi.mock("@/lib/permissions", () => ({ canManagePricing: () => true }));

import { GET } from "./route";

function transaction(index: number) {
  return {
    id: `tx-${String(index).padStart(3, "0")}`,
    giftCardId: "card-1",
    type: "ISSUE" as const,
    amountDelta: { toFixed: () => "1.00" },
    createdAt: new Date("2026-11-05T12:00:00.000Z"),
    createdById: null,
    giftCard: { codeLastFour: "0123" },
    order: null,
    refund: null,
  };
}

describe("GET /gift-cards/transactions/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1", currency: "GHS", timezone: "Africa/Accra" },
      membership: { role: "OWNER" },
    });
    findGiftCard.mockResolvedValue(null);
    findUsers.mockResolvedValue([]);
  });

  it("streams keyset batches without resetting per-card balances", async () => {
    findTransactions
      .mockResolvedValueOnce(Array.from({ length: 500 }, (_, index) => transaction(index)))
      .mockResolvedValueOnce([transaction(500)]);

    const response = await GET(new Request("http://localhost/gift-cards/transactions/export"));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(findTransactions).toHaveBeenCalledTimes(2);
    expect(findTransactions.mock.calls[0][0]).toMatchObject({
      take: 500,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      where: { organizationId: "org-1" },
    });
    expect(findTransactions.mock.calls[1][0].where.AND[1].OR).toEqual([
      { createdAt: { gt: new Date("2026-11-05T12:00:00.000Z") } },
      { createdAt: new Date("2026-11-05T12:00:00.000Z"), id: { gt: "tx-499" } },
    ]);
    expect(csv).toContain('"ISSUE","•••• 0123","","System","CREDIT","1.00","500.00","GHS"');
    expect(csv).toContain('"ISSUE","•••• 0123","","System","CREDIT","1.00","501.00","GHS"');
    expect(csv).toContain('"Issued","","","","","","501.00","","GHS"');
  });

  it("streams headers and zero totals when no transactions match", async () => {
    findTransactions.mockResolvedValueOnce([]);

    const response = await GET(new Request("http://localhost/gift-cards/transactions/export"));
    const csv = await response.text();

    expect(findTransactions).toHaveBeenCalledOnce();
    expect(csv).toContain('"Recorded at","Event","Code suffix"');
    expect(csv).toContain('"Issued","","","","","","0.00","","GHS"');
  });
});
