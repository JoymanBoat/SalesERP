import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findOrders, findRefunds, getWorkspace } = vi.hoisted(() => ({
  findOrders: vi.fn(),
  findRefunds: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findMany: findOrders },
    refund: { findMany: findRefunds },
  },
}));

vi.mock("@/lib/workspace", () => ({ getWorkspace }));

import { MembershipRole, OrderStatus, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { GET } from "./route";

describe("GET /reports/accounting-export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00.000Z"));
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1", currency: "GHS" },
      store: { id: "store-1" },
      membership: { role: MembershipRole.ACCOUNTANT },
    });
    findOrders.mockResolvedValue([]);
    findRefunds.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports store-scoped sale tenders and signed cash/gift-card refund flows", async () => {
    const firstPaidAt = new Date("2026-11-03T10:00:00.000Z");
    const secondPaidAt = new Date("2026-11-03T10:05:00.000Z");
    const refundedAt = new Date("2026-11-04T10:00:00.000Z");
    findOrders.mockResolvedValue([{
      number: 42,
      subtotal: new Prisma.Decimal("100.00"),
      discountTotal: new Prisma.Decimal("5.00"),
      taxTotal: new Prisma.Decimal("9.50"),
      total: new Prisma.Decimal("104.50"),
      payments: [
        { method: PaymentMethod.CASH, amount: new Prisma.Decimal("54.50"), createdAt: firstPaidAt },
        { method: PaymentMethod.GIFT_CARD, amount: new Prisma.Decimal("50.00"), createdAt: secondPaidAt },
      ],
    }]);
    findRefunds.mockResolvedValue([{
      createdAt: refundedAt,
      amount: new Prisma.Decimal("20.00"),
      cashRefundAmount: new Prisma.Decimal("5.00"),
      order: { number: 42 },
    }]);

    const response = await GET(new Request("http://localhost/reports/accounting-export?days=7"));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("sales-accounting-7-days.csv");
    expect(csv).toContain('"2026-11-03T10:00:00.000Z","SALE","42","100.00","5.00","9.50","104.50","","54.50","50.00","GHS"');
    expect(csv).toContain('"2026-11-04T10:00:00.000Z","REFUND","42","","","","","-20.00","-5.00","-15.00","GHS"');

    const expectedSince = new Date("2026-10-29T12:00:00.000Z");
    const expectedNow = new Date("2026-11-05T12:00:00.000Z");
    expect(findOrders).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        storeId: "store-1",
        status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED] },
        payments: {
          some: {
            createdAt: { gte: expectedSince, lte: expectedNow },
            status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED] },
          },
        },
      }),
    }));
    expect(findOrders.mock.calls[0][0].select.payments.where).toEqual({
      createdAt: { gte: expectedSince, lte: expectedNow },
      status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED] },
    });
    expect(findRefunds).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        storeId: "store-1",
        createdAt: { gte: expectedSince, lte: expectedNow },
      },
    }));
  });

  it("denies cashier access before querying financial records", async () => {
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1", currency: "GHS" },
      store: { id: "store-1" },
      membership: { role: MembershipRole.CASHIER },
    });

    const response = await GET(new Request("http://localhost/reports/accounting-export"));

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(findOrders).not.toHaveBeenCalled();
    expect(findRefunds).not.toHaveBeenCalled();
  });
});
