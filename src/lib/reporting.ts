import { OrderStatus, Prisma } from "@prisma/client";

export const reportPeriods = [7, 30, 90] as const;

export type ReportPeriod = (typeof reportPeriods)[number];

export type SalesTrendBucket = {
  period: string;
  revenue: Prisma.Decimal;
  orderCount: bigint;
};

export type AccountingSale = {
  date: Date;
  number: number;
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
  cash: Prisma.Decimal;
  giftCard: Prisma.Decimal;
};

export type AccountingRefund = {
  date: Date;
  number: number;
  amount: Prisma.Decimal;
  cashRefundAmount: Prisma.Decimal;
};

export type CustomerRetentionBucket = {
  orderCount: bigint;
  netSpend: Prisma.Decimal;
};

export function calculateCustomerRetentionMetrics(customers: CustomerRetentionBucket[]) {
  const activeCustomerCount = customers.length;
  const repeatCustomers = customers.filter((customer) => customer.orderCount > 1n);
  const repeatCustomerCount = repeatCustomers.length;
  const repeatCustomerNetSales = repeatCustomers.reduce(
    (total, customer) => total.plus(customer.netSpend),
    new Prisma.Decimal(0),
  );
  return {
    activeCustomerCount,
    repeatCustomerCount,
    repeatCustomerRate: activeCustomerCount > 0
      ? Number((BigInt(repeatCustomerCount) * 10000n / BigInt(activeCustomerCount))) / 100
      : 0,
    repeatCustomerNetSales,
  };
}

function taxComponentColumns(components: Parameters<typeof buildTaxSnapshotRows>[0][number]["components"]) {
  if (!components) return ["", "", "", "", "", "", "", ""];
  if (!components.recorded) return ["", "", "", "", "", "", "LEGACY_COMBINED_ONLY", ""];
  const counts = new Map<string, number>();
  for (const treatment of components.treatments) counts.set(treatment, (counts.get(treatment) ?? 0) + 1);
  return [
    components.vatRate.toFixed(2),
    components.vat.toFixed(2),
    components.nhilRate.toFixed(2),
    components.nhil.toFixed(2),
    components.getfundRate.toFixed(2),
    components.getfund.toFixed(2),
    "RECORDED",
    [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([treatment, count]) => `${treatment}:${count}`).join(";"),
  ];
}

export function buildTaxSnapshotRows(
  sales: Array<{
    date: Date;
    number: number;
    taxRate: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    discount: Prisma.Decimal;
    tax: Prisma.Decimal;
    total: Prisma.Decimal;
    components?: {
      recorded: boolean;
      vatRate: Prisma.Decimal;
      vat: Prisma.Decimal;
      nhilRate: Prisma.Decimal;
      nhil: Prisma.Decimal;
      getfundRate: Prisma.Decimal;
      getfund: Prisma.Decimal;
      treatments: string[];
    };
  }>,
  refunds: Array<{ date: Date; number: number; amount: Prisma.Decimal }>,
  currency: string,
) {
  const rows = [
    ...sales.map((sale) => ({
      date: sale.date,
      row: [
        sale.date.toISOString(),
        "SALE",
        sale.number,
        sale.taxRate.toFixed(2),
        sale.subtotal.minus(sale.discount).toFixed(2),
        sale.tax.toFixed(2),
        sale.total.toFixed(2),
        "",
        currency,
        "Recorded order tax snapshot",
        ...taxComponentColumns(sale.components),
      ],
    })),
    ...refunds.map((refund) => ({
      date: refund.date,
      row: [
        refund.date.toISOString(),
        "REFUND",
        refund.number,
        "",
        "",
        "",
        "",
        refund.amount.negated().toFixed(2),
        currency,
        "Refund tax allocation is not stored; review against source receipt",
        ...taxComponentColumns(undefined),
      ],
    })),
  ];
  rows.sort((a, b) => a.date.getTime() - b.date.getTime() || String(a.row[1]).localeCompare(String(b.row[1])));
  return [
    ["Event date (UTC)", "Event", "Sale number", "Saved tax rate (%)", "Subtotal after discount", "Recorded tax snapshot", "Sale total", "Refund total", "Currency", "Tax note", "VAT rate (%)", "VAT", "NHIL rate (%)", "NHIL", "GETFund rate (%)", "GETFund", "Component snapshot", "Item tax treatments"],
    ...rows.map(({ row }) => row),
  ];
}

export function parseReportPeriod(value: string | undefined): ReportPeriod {
  if (value === "7") return 7;
  if (value === "90") return 90;
  return 30;
}

export function buildSalesAccountingRows(
  sales: AccountingSale[],
  refunds: AccountingRefund[],
  currency: string,
) {
  const rows = [
    ...sales.map((sale) => ({
      date: sale.date,
      row: [
        sale.date.toISOString(),
        "SALE",
        sale.number,
        sale.subtotal.toFixed(2),
        sale.discount.toFixed(2),
        sale.tax.toFixed(2),
        sale.total.toFixed(2),
        "",
        sale.cash.toFixed(2),
        sale.giftCard.toFixed(2),
        currency,
      ],
    })),
    ...refunds.map((refund) => ({
      date: refund.date,
      row: [
        refund.date.toISOString(),
        "REFUND",
        refund.number,
        "",
        "",
        "",
        "",
        refund.amount.negated().toFixed(2),
        refund.cashRefundAmount.negated().toFixed(2),
        refund.amount.minus(refund.cashRefundAmount).negated().toFixed(2),
        currency,
      ],
    })),
  ];
  rows.sort((a, b) => a.date.getTime() - b.date.getTime() || String(a.row[1]).localeCompare(String(b.row[1])));
  return [
    ["Event date (UTC)", "Event", "Sale number", "Subtotal", "Discount", "Tax snapshot", "Sale total", "Refund total", "Cash flow", "Gift card flow", "Currency"],
    ...rows.map(({ row }) => row),
  ];
}

export function buildSalesTrendQuery({
  organizationId,
  storeId,
  timezone,
  since,
  now,
  days,
}: {
  organizationId: string;
  storeId: string;
  timezone: string;
  since: Date;
  now: Date;
  days: ReportPeriod;
}) {
  const bucket = days === 7 ? "day" : "week";
  return Prisma.sql`
    WITH periods AS (
      SELECT generate_series(
        date_trunc(${bucket}, ${since} AT TIME ZONE ${timezone}),
        date_trunc(${bucket}, ${now} AT TIME ZONE ${timezone}),
        ('1 ' || ${bucket})::interval
      ) AS period_start
    )
    SELECT to_char(periods.period_start, 'YYYY-MM-DD') AS period,
      COALESCE(SUM(order_record."total" - refund_totals.amount), 0)::numeric AS revenue,
      COUNT(order_record."id")::bigint AS "orderCount"
    FROM periods
    LEFT JOIN "Order" AS order_record
      ON date_trunc(${bucket}, order_record."createdAt" AT TIME ZONE ${timezone}) = periods.period_start
      AND order_record."organizationId" = ${organizationId}
      AND order_record."storeId" = ${storeId}
      AND order_record."status" IN (
        ${OrderStatus.PAID}::"OrderStatus",
        ${OrderStatus.PARTIALLY_REFUNDED}::"OrderStatus",
        ${OrderStatus.REFUNDED}::"OrderStatus"
      )
      AND order_record."createdAt" >= ${since}
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(refund."amount"), 0)::numeric AS amount
      FROM "Refund" AS refund
      WHERE refund."orderId" = order_record."id"
    ) AS refund_totals ON order_record."id" IS NOT NULL
    GROUP BY periods.period_start
    ORDER BY periods.period_start
  `;
}

export function toCsvCell(value: string | number) {
  const text = String(value);
  const isPlainDecimal = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text);
  const safeText = !isPlainDecimal && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}
