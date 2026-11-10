import { MembershipRole, NotificationType, OrderStatus, Prisma } from "@prisma/client";

import { sendEmail } from "@/lib/email";
import { formatGhanaCedis } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import {
  getBusinessDate,
  getBusinessDateRange,
  getPreviousBusinessDate,
  getWeeklyNotificationBucket,
} from "@/lib/notification-time";

type StoreContext = {
  id: string;
  name: string;
  organizationId: string;
  organization: {
    name: string;
    timezone: string;
    currency: string;
  };
};

type NotificationDraft = {
  type: NotificationType;
  eventKey: string;
  title: string;
  body: string;
  href: string;
};

const supplierOpenStatuses = ["ORDERED", "PARTIALLY_RECEIVED"] as const;
const stockRoles = [MembershipRole.OWNER, MembershipRole.MANAGER, MembershipRole.INVENTORY_MANAGER];
const invoiceRoles = [MembershipRole.OWNER, MembershipRole.MANAGER, MembershipRole.ACCOUNTANT];
const summaryRoles = [MembershipRole.OWNER, MembershipRole.MANAGER];

function getNextBusinessDateStart(date: string) {
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return new Date(`${nextDate.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

async function getRecipients(store: StoreContext, roles: MembershipRole[]) {
  return prisma.organizationMembership.findMany({
    where: {
      organizationId: store.organizationId,
      role: { in: roles },
      OR: [
        { role: MembershipRole.OWNER },
        { storeAssignments: { some: { storeId: store.id } } },
      ],
    },
    select: {
      id: true,
      user: { select: { name: true, email: true } },
    },
  });
}

async function createNotifications(store: StoreContext, drafts: NotificationDraft[], roles: MembershipRole[]) {
  if (drafts.length === 0) return 0;
  const recipients = await getRecipients(store, roles);
  if (recipients.length === 0) return 0;
  const result = await prisma.inAppNotification.createMany({
    data: drafts.flatMap((draft) => recipients.map(({ id }) => ({
      organizationId: store.organizationId,
      storeId: store.id,
      membershipId: id,
      ...draft,
    }))),
    skipDuplicates: true,
  });
  return result.count;
}

async function getLowStockDrafts(store: StoreContext, businessDate: string) {
  const lowStockRows = await prisma.$queryRaw<{
    id: string;
    productName: string;
    variantName: string;
    quantity: number;
    reorderPoint: number;
  }[]>(Prisma.sql`
    SELECT level."variantId" AS id,
      product."name" AS "productName",
      variant."name" AS "variantName",
      level."quantity",
      level."reorderPoint"
    FROM "InventoryLevel" AS level
    INNER JOIN "ProductVariant" AS variant ON variant."id" = level."variantId"
    INNER JOIN "Product" AS product ON product."id" = variant."productId"
    WHERE level."organizationId" = ${store.organizationId}
      AND level."storeId" = ${store.id}
      AND variant."trackInventory" = true
      AND product."archivedAt" IS NULL
      AND level."quantity" <= level."reorderPoint"
    ORDER BY level."quantity" ASC, product."name" ASC, variant."name" ASC
  `);
  const weeklyBucket = getWeeklyNotificationBucket(businessDate);
  return lowStockRows.map((row) => ({
    type: NotificationType.LOW_STOCK,
    eventKey: `low-stock:${store.id}:${row.id}:${weeklyBucket}`,
    title: `Low stock: ${row.productName}`,
    body: `${row.variantName} has ${row.quantity} on hand; its reorder point is ${row.reorderPoint}.`,
    href: "/inventory?status=low",
  }));
}

async function getSupplierFollowUpDrafts(store: StoreContext, businessDate: string) {
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      organizationId: store.organizationId,
      storeId: store.id,
      status: { in: [...supplierOpenStatuses] },
      nextFollowUpAt: { lt: getNextBusinessDateStart(businessDate) },
    },
    select: {
      id: true,
      number: true,
      nextFollowUpAt: true,
      supplier: { select: { businessName: true } },
    },
  });
  return orders.flatMap((order) => {
    if (!order.nextFollowUpAt) return [];
    const dueDate = order.nextFollowUpAt.toISOString().slice(0, 10);
    return [{
      type: NotificationType.SUPPLIER_FOLLOW_UP,
      eventKey: `supplier-follow-up:${store.id}:${order.id}:${dueDate}`,
      title: `Supplier follow-up due: PO #${order.number}`,
      body: `Follow up with ${order.supplier.businessName} about purchase order #${order.number}.`,
      href: "/purchasing?status=FOLLOWUP_DUE",
    }];
  });
}

async function getInvoiceDrafts(store: StoreContext, businessDate: string) {
  const dueSoonEnd = getNextBusinessDateStart(businessDate);
  dueSoonEnd.setUTCDate(dueSoonEnd.getUTCDate() + 6);
  const invoices = await prisma.supplierInvoice.findMany({
    where: {
      organizationId: store.organizationId,
      storeId: store.id,
      dueDate: { lt: dueSoonEnd },
    },
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      dueDate: true,
      purchaseOrder: { select: { number: true } },
      supplier: { select: { businessName: true } },
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true } },
    },
  });
  const todayStart = new Date(`${businessDate}T00:00:00.000Z`);
  const drafts: NotificationDraft[] = [];

  for (const invoice of invoices) {
    const paid = invoice.payments.reduce((total, payment) => total.plus(payment.amount), new Prisma.Decimal(0));
    const credited = invoice.creditNotes.reduce((total, credit) => total.plus(credit.amount), new Prisma.Decimal(0));
    const balance = invoice.amount.minus(paid).minus(credited);
    if (balance.lessThanOrEqualTo(0) || !invoice.dueDate) continue;

    const overdue = invoice.dueDate < todayStart;
    const type = overdue ? NotificationType.SUPPLIER_INVOICE_OVERDUE : NotificationType.SUPPLIER_INVOICE_DUE_SOON;
    const category = overdue ? "overdue" : "due-soon";
    drafts.push({
      type,
      eventKey: `supplier-invoice:${store.id}:${invoice.id}:${category}:${invoice.dueDate.toISOString().slice(0, 10)}`,
      title: overdue
        ? `Overdue supplier invoice: ${invoice.invoiceNumber}`
        : `Supplier invoice due soon: ${invoice.invoiceNumber}`,
      body: `${invoice.supplier.businessName} · PO #${invoice.purchaseOrder.number} · balance ${formatGhanaCedis(balance.toString())} · due ${invoice.dueDate.toISOString().slice(0, 10)}.`,
      href: `/purchasing?status=${overdue ? "INVOICE_OVERDUE" : "INVOICE_DUE_SOON"}`,
    });
  }
  return drafts;
}

async function getDailySalesDraft(store: StoreContext, businessDate: string): Promise<NotificationDraft> {
  const { start, end } = getBusinessDateRange(businessDate, store.organization.timezone);
  const [sales, refunds] = await Promise.all([
    prisma.order.aggregate({
      where: {
        organizationId: store.organizationId,
        storeId: store.id,
        status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED] },
        createdAt: { gte: start, lt: end },
      },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.refund.aggregate({
      where: {
        organizationId: store.organizationId,
        storeId: store.id,
        createdAt: { gte: start, lt: end },
      },
      _sum: { amount: true },
    }),
  ]);
  const totalSales = sales._sum.total ?? new Prisma.Decimal(0);
  const refunded = refunds._sum.amount ?? new Prisma.Decimal(0);
  const netSales = totalSales.minus(refunded);
  return {
    type: NotificationType.DAILY_SALES_SUMMARY,
    eventKey: `daily-sales:${store.id}:${businessDate}`,
    title: `Daily sales summary · ${businessDate}`,
    body: `${sales._count._all.toLocaleString("en-GH")} completed sales · net ${formatGhanaCedis(netSales.toString())} after ${formatGhanaCedis(refunded.toString())} in refunds.`,
    href: "/reports",
  };
}

async function deliverPendingEmailNotifications() {
  const staleAttemptBefore = new Date(Date.now() - 5 * 60 * 1000);
  const pending = await prisma.inAppNotification.findMany({
    where: {
      emailSentAt: null,
      emailSuppressedAt: null,
      store: { active: true },
      OR: [{ emailAttemptAt: null }, { emailAttemptAt: { lt: staleAttemptBefore } }],
    },
    include: {
      membership: {
        include: {
          user: { select: { email: true } },
          storeAssignments: { select: { storeId: true } },
        },
      },
      organization: { select: { name: true } },
      store: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  let sent = 0;
  let failed = 0;
  const attemptedAt = new Date();

  for (const notification of pending) {
    const allowedRoles = notification.type === NotificationType.SUPPLIER_INVOICE_OVERDUE
      || notification.type === NotificationType.SUPPLIER_INVOICE_DUE_SOON
      ? invoiceRoles
      : notification.type === NotificationType.DAILY_SALES_SUMMARY
        ? summaryRoles
        : stockRoles;
    const hasCurrentAccess = allowedRoles.some((role) => role === notification.membership.role)
      && (notification.membership.role === MembershipRole.OWNER
        || notification.membership.storeAssignments.some(({ storeId }) => storeId === notification.storeId));
    if (!hasCurrentAccess) {
      await prisma.inAppNotification.updateMany({
        where: { id: notification.id, emailSentAt: null },
        data: { emailSuppressedAt: new Date() },
      });
      continue;
    }

    const claimed = await prisma.inAppNotification.updateMany({
      where: {
        id: notification.id,
        emailSentAt: null,
        OR: [{ emailAttemptAt: null }, { emailAttemptAt: { lt: staleAttemptBefore } }],
      },
      data: { emailAttemptAt: attemptedAt },
    });
    if (claimed.count !== 1) continue;

    try {
      const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
      const link = new URL(notification.href, baseUrl).toString();
      await sendEmail({
        to: notification.membership.user.email,
        subject: notification.title,
        text: [
          notification.title,
          "",
          notification.body,
          "",
          `${notification.organization.name} · ${notification.store.name}`,
          `Open in SalesERP: ${link}`,
        ].join("\n"),
      });
      await prisma.inAppNotification.updateMany({
        where: { id: notification.id, emailAttemptAt: attemptedAt },
        data: { emailSentAt: new Date(), emailAttemptAt: null },
      });
      sent += 1;
    } catch (error) {
      console.error("Could not deliver a notification email.", error);
      failed += 1;
    }
  }

  return { sent, failed };
}

export async function runScheduledNotifications(now = new Date()) {
  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true, timezone: true, currency: true, stores: { where: { active: true }, select: { id: true, name: true } } },
  });
  let created = 0;
  for (const organization of organizations) {
    const currentBusinessDate = getBusinessDate(now, organization.timezone);
    const summaryDate = getPreviousBusinessDate(currentBusinessDate);
    for (const activeStore of organization.stores) {
      const store: StoreContext = { ...activeStore, organizationId: organization.id, organization };
      const [lowStock, followUps, invoices, salesSummary] = await Promise.all([
        getLowStockDrafts(store, currentBusinessDate),
        getSupplierFollowUpDrafts(store, currentBusinessDate),
        getInvoiceDrafts(store, currentBusinessDate),
        getDailySalesDraft(store, summaryDate),
      ]);
      created += await createNotifications(store, lowStock, stockRoles);
      created += await createNotifications(store, followUps, stockRoles);
      created += await createNotifications(store, invoices, invoiceRoles);
      created += await createNotifications(store, [salesSummary], summaryRoles);
    }
  }
  const delivery = await deliverPendingEmailNotifications();
  return { created, ...delivery };
}
