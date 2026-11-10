import { OrderStatus, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";

import { buildSalesAccountingRows, parseReportPeriod, toCsvCell } from "@/lib/reporting";
import { canManageSupplierInvoices } from "@/lib/permissions";
import { getWorkspace } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { organization, store, membership } = await getWorkspace({ feature: "reports", operation: "view" });
  if (!canManageSupplierInvoices(membership.role)) {
    return new Response("Accounting exports are available to owners, managers, and accountants.", {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const searchParams = new URL(request.url).searchParams;
  const days = parseReportPeriod(searchParams.get("days") ?? undefined);
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const paymentStatuses = [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED];
  const [orders, refunds] = await Promise.all([
    prisma.order.findMany({
      where: {
        organizationId: organization.id,
        storeId: store.id,
        status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED] },
        payments: { some: { createdAt: { gte: since, lte: now }, status: { in: paymentStatuses } } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        number: true,
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        total: true,
        payments: {
          where: { createdAt: { gte: since, lte: now }, status: { in: paymentStatuses } },
          select: { method: true, amount: true, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    }),
    prisma.refund.findMany({
      where: {
        organizationId: organization.id,
        storeId: store.id,
        createdAt: { gte: since, lte: now },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        createdAt: true,
        amount: true,
        cashRefundAmount: true,
        order: { select: { number: true } },
      },
    }),
  ]);
  const sales = orders.flatMap((order) => {
    const datedPayments = order.payments.filter((payment) => payment.createdAt >= since && payment.createdAt <= now);
    if (!datedPayments.length) return [];
    return [{
      date: datedPayments[0].createdAt,
      number: order.number,
      subtotal: order.subtotal,
      discount: order.discountTotal,
      tax: order.taxTotal,
      total: order.total,
      cash: datedPayments.filter((payment) => payment.method === PaymentMethod.CASH)
        .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0)),
      giftCard: datedPayments.filter((payment) => payment.method === PaymentMethod.GIFT_CARD)
        .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0)),
    }];
  });
  const rows = buildSalesAccountingRows(
    sales,
    refunds.map((refund) => ({
      date: refund.createdAt,
      number: refund.order.number,
      amount: refund.amount,
      cashRefundAmount: refund.cashRefundAmount,
    })),
    organization.currency,
  );
  const csv = `\uFEFF${rows.map((row) => row.map(toCsvCell).join(",")).join("\r\n")}\r\n`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-accounting-${days}-days.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
