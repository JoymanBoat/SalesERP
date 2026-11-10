import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const {
  aggregateOrder,
  aggregateRefund,
  createMany,
  findInvoices,
  findMemberships,
  findOrganizations,
  findOrders,
  findNotifications,
  queryRaw,
  sendEmail,
  updateMany,
} = vi.hoisted(() => ({
  aggregateOrder: vi.fn(),
  aggregateRefund: vi.fn(),
  createMany: vi.fn(),
  findInvoices: vi.fn(),
  findMemberships: vi.fn(),
  findOrganizations: vi.fn(),
  findOrders: vi.fn(),
  findNotifications: vi.fn(),
  queryRaw: vi.fn(),
  sendEmail: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: queryRaw,
    organization: { findMany: findOrganizations },
    organizationMembership: { findMany: findMemberships },
    purchaseOrder: { findMany: findOrders },
    supplierInvoice: { findMany: findInvoices },
    order: { aggregate: aggregateOrder },
    refund: { aggregate: aggregateRefund },
    inAppNotification: {
      createMany,
      findMany: findNotifications,
      updateMany,
    },
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail }));

import { runScheduledNotifications } from "./notifications";

describe("runScheduledNotifications", () => {
  beforeEach(() => {
    findOrganizations.mockReset().mockResolvedValue([{
      id: "org-a",
      name: "Keta Retail",
      timezone: "Africa/Accra",
      currency: "GHS",
      stores: [{ id: "store-a", name: "Main shop" }],
    }]);
    findMemberships.mockReset().mockImplementation(({ where }) =>
      where.role.in.map((role: string) => ({
        id: `membership-${role}`,
        role,
        user: { email: `${role.toLowerCase()}@example.com` },
      })),
    );
    queryRaw.mockReset().mockResolvedValue([{
      id: "variant-a",
      productName: "Rice",
      variantName: "5 kg bag",
      quantity: 2,
      reorderPoint: 5,
    }]);
    findOrders.mockReset().mockResolvedValue([{
      id: "po-a",
      number: 12,
      nextFollowUpAt: new Date("2026-11-06T00:00:00.000Z"),
      supplier: { businessName: "Supplier A" },
    }]);
    findInvoices.mockReset().mockResolvedValue([
      {
        id: "invoice-overdue",
        invoiceNumber: "INV-001",
        amount: new Prisma.Decimal("75.00"),
        dueDate: new Date("2026-11-05T00:00:00.000Z"),
        purchaseOrder: { number: 12 },
        supplier: { businessName: "Supplier A" },
        payments: [],
        creditNotes: [],
      },
      {
        id: "invoice-soon",
        invoiceNumber: "INV-002",
        amount: new Prisma.Decimal("45.00"),
        dueDate: new Date("2026-11-09T00:00:00.000Z"),
        purchaseOrder: { number: 13 },
        supplier: { businessName: "Supplier B" },
        payments: [],
        creditNotes: [],
      },
    ]);
    aggregateOrder.mockReset().mockResolvedValue({ _sum: { total: new Prisma.Decimal("250.00") }, _count: { _all: 4 } });
    aggregateRefund.mockReset().mockResolvedValue({ _sum: { amount: new Prisma.Decimal("25.00") } });
    createMany.mockReset().mockImplementation(async ({ data }) => ({ count: data.length }));
    findNotifications.mockReset().mockResolvedValue([{
      id: "notification-a",
      organizationId: "org-a",
      storeId: "store-a",
      type: "DAILY_SALES_SUMMARY",
      title: "Daily sales summary",
      body: "4 completed sales",
      href: "/reports",
      membership: {
        role: "OWNER",
        user: { email: "owner@example.com" },
        storeAssignments: [],
      },
      organization: { name: "Keta Retail" },
      store: { name: "Main shop" },
    }]);
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    sendEmail.mockReset().mockResolvedValue(undefined);
  });

  it("creates every selected notification type for the appropriate workspace roles", async () => {
    const result = await runScheduledNotifications(new Date("2026-11-06T01:00:00.000Z"));
    const inserted = createMany.mock.calls.flatMap(([input]) => input.data);

    expect(result).toEqual({ created: inserted.length, sent: 1, failed: 0 });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.com",
      subject: "Daily sales summary",
      text: expect.stringContaining("Keta Retail · Main shop"),
    }));
    expect(new Set(inserted.map(({ type }) => type))).toEqual(new Set([
      "LOW_STOCK",
      "SUPPLIER_FOLLOW_UP",
      "SUPPLIER_INVOICE_OVERDUE",
      "SUPPLIER_INVOICE_DUE_SOON",
      "DAILY_SALES_SUMMARY",
    ]));
    expect(inserted.some(({ eventKey, title, body }) =>
      eventKey === "daily-sales:store-a:2026-11-05"
      && title.includes("2026-11-05")
      && body.includes("4 completed sales"),
    )).toBe(true);

    const dailySummaryMemberships = inserted
      .filter(({ type }) => type === "DAILY_SALES_SUMMARY")
      .map(({ membershipId }) => membershipId);
    expect(dailySummaryMemberships).toEqual(["membership-OWNER", "membership-MANAGER"]);
    expect(inserted.filter(({ type }) => type === "LOW_STOCK")
      .every(({ membershipId }) => ["membership-OWNER", "membership-MANAGER", "membership-INVENTORY_MANAGER"].includes(membershipId)))
      .toBe(true);
    expect(inserted.filter(({ type }) => type === "SUPPLIER_INVOICE_OVERDUE")
      .every(({ membershipId }) => ["membership-OWNER", "membership-MANAGER", "membership-ACCOUNTANT"].includes(membershipId)))
      .toBe(true);
  });
});
