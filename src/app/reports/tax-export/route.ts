import { OrderStatus, PaymentStatus } from "@prisma/client";

import { canManageSupplierInvoices } from "@/lib/permissions";
import { buildTaxSnapshotRows, parseReportPeriod, toCsvCell } from "@/lib/reporting";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

export async function GET(request: Request) {
  const { organization, store, membership } = await getWorkspace({ feature: "reports", operation: "view" });
  if (!canManageSupplierInvoices(membership.role)) {
    return new Response("Tax snapshot exports are available to owners, managers, and accountants.", {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const days = parseReportPeriod(new URL(request.url).searchParams.get("days") ?? undefined);
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
        taxRate: true,
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        total: true,
        taxComponentsRecorded: true,
        vatRate: true,
        vatTotal: true,
        nhilRate: true,
        nhilTotal: true,
        getfundRate: true,
        getfundTotal: true,
        items: { select: { taxTreatment: true }, orderBy: { id: "asc" } },
        payments: {
          where: { createdAt: { gte: since, lte: now }, status: { in: paymentStatuses } },
          select: { createdAt: true },
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
        order: { select: { number: true } },
      },
    }),
  ]);
  const sales = orders.flatMap((order) => {
    const payment = order.payments.find((entry) => entry.createdAt >= since && entry.createdAt <= now);
    return payment ? [{
      date: payment.createdAt,
      number: order.number,
      taxRate: order.taxRate,
      subtotal: order.subtotal,
      discount: order.discountTotal,
      tax: order.taxTotal,
      total: order.total,
      components: {
        recorded: order.taxComponentsRecorded,
        vatRate: order.vatRate,
        vat: order.vatTotal,
        nhilRate: order.nhilRate,
        nhil: order.nhilTotal,
        getfundRate: order.getfundRate,
        getfund: order.getfundTotal,
        treatments: order.items.map((item) => item.taxTreatment),
      },
    }] : [];
  });
  const rows = buildTaxSnapshotRows(
    sales,
    refunds.map((refund) => ({
      date: refund.createdAt,
      number: refund.order.number,
      amount: refund.amount,
    })),
    organization.currency,
  );
  const csv = `\uFEFF${rows.map((row) => row.map(toCsvCell).join(",")).join("\r\n")}\r\n`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tax-snapshots-${days}-days.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
