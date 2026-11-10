import { OrderStatus, Prisma } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { findOrder, findSubscription } = vi.hoisted(() => ({ findOrder: vi.fn(), findSubscription: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findFirst: findOrder }, organizationSubscription: { findUnique: findSubscription } } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

import { createReceiptToken } from "@/lib/receipt-link";
import SharedReceipt from "./page";

const secret = "test-secret-at-least-32-characters-long";
const orderId = "clh1p2s3t0000qwertyuiopas";

describe("shared receipt", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("shows a completed sale without private customer details", async () => {
    vi.stubEnv("AUTH_SECRET", secret);
    findSubscription.mockResolvedValue(null);
    findOrder.mockResolvedValue({
      organizationId: "org-1", number: 7, status: OrderStatus.PAID, createdAt: new Date("2026-01-01T10:00:00Z"),
      subtotal: new Prisma.Decimal("10"), discountTotal: new Prisma.Decimal("0"),
      taxTotal: new Prisma.Decimal("1"), total: new Prisma.Decimal("11"),
      organization: { name: "Shop", timezone: "Africa/Accra" }, store: { name: "Main" },
      items: [{ id: "item-1", productName: "Tea", quantity: 1, unitPrice: new Prisma.Decimal("10"), lineTotal: new Prisma.Decimal("11") }],
      refunds: [],
    });
    const token = createReceiptToken(orderId, secret);
    const markup = renderToStaticMarkup(await SharedReceipt({ params: Promise.resolve({ token }) }));
    expect(markup).toContain("Shop");
    expect(markup).toContain("Tea");
    expect(markup).toContain("Receipt · Sale #7");
    expect(findOrder).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: orderId, status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED] } }),
      select: expect.not.objectContaining({ customer: expect.anything(), notes: expect.anything() }),
    }));
    expect(findSubscription).toHaveBeenCalledWith({ where: { organizationId: "org-1" }, include: { package: true } });
  });

  it("rejects expired links before querying the database", async () => {
    vi.stubEnv("AUTH_SECRET", secret);
    const token = createReceiptToken(orderId, secret, Date.now() - 31 * 86400 * 1000);
    await expect(SharedReceipt({ params: Promise.resolve({ token }) })).rejects.toThrow("NOT_FOUND");
    expect(findOrder).not.toHaveBeenCalled();
  });
});
