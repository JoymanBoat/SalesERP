import Link from "next/link";
import { OrderStatus, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";

import { WorkspaceShell } from "@/components/workspace-shell";
import { formatGhanaCedis } from "@/lib/currency";
import { canManageSupplierInvoices } from "@/lib/permissions";
import { businessDateInTimeZone } from "@/lib/pos";
import { buildSalesTrendQuery, calculateCustomerRetentionMetrics, parseReportPeriod, type CustomerRetentionBucket, type SalesTrendBucket } from "@/lib/reporting";
import { prisma } from "@/lib/prisma";
import { getSupplierInvoiceAging } from "@/lib/supplier-invoice-aging";
import { summarizeSupplierInvoiceAging } from "@/lib/supplier-invoice-aging-csv";
import type { SupplierInvoiceAgingRow } from "@/lib/supplier-invoice-aging-csv";
import { getWorkspace } from "@/lib/workspace";

const paymentMethodLabels: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  MOBILE_MONEY: "Mobile money",
  GIFT_CARD: "Gift card",
  STORE_CREDIT: "Store credit",
  OTHER: "Other",
};

type SupplierPerformanceRow = {
  supplierId: string;
  supplierName: string;
  orderCount: bigint;
  completedOrderCount: bigint;
  unitsOrdered: bigint;
  unitsReceived: bigint;
  receivedValue: Prisma.Decimal;
};

function getPeriodLabel(days: number) {
  return `Last ${days} days`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { session, membership, organization, store } = await getWorkspace({ feature: "reports", operation: "view" });
  const { days: rawDays } = await searchParams;
  const days = parseReportPeriod(rawDays);
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const businessDate = businessDateInTimeZone(now, organization.timezone);
  const businessDateStart = new Date(`${businessDate}T00:00:00.000Z`);
  const orderWhere = { organizationId: organization.id, storeId: store.id, createdAt: { gte: since } };
  const paidOrderWhere = {
    ...orderWhere,
    status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED] },
  };

  const supplierInvoiceAgingPromise = canManageSupplierInvoices(membership.role)
    ? getSupplierInvoiceAging(organization.id, store.id, businessDate)
    : Promise.resolve([] as SupplierInvoiceAgingRow[]);

  const [paidSales, refunds, orderCount, ordersByStatus, paymentsByMethod, topProducts, salesOverTime, supplierPerformance, customerRetentionRows, supplierInvoiceAging] = await Promise.all([
    prisma.order.aggregate({
      where: paidOrderWhere,
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.refund.aggregate({
      where: { organizationId: organization.id, storeId: store.id, order: { createdAt: { gte: since } } },
      _sum: { amount: true },
    }),
    prisma.order.count({ where: orderWhere }),
    prisma.order.groupBy({
      by: ["status"],
      where: orderWhere,
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["method"],
      where: {
        status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED] },
        createdAt: { gte: since },
        order: { organizationId: organization.id, storeId: store.id, createdAt: { gte: since } },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ productName: string; sku: string; unitsSold: bigint; revenue: Prisma.Decimal }[]>(Prisma.sql`
      SELECT item."productName", item."sku",
        SUM(item."quantity")::bigint AS "unitsSold",
        SUM(item."lineTotal")::numeric AS revenue
      FROM "OrderItem" AS item
      INNER JOIN "Order" AS order_record ON order_record."id" = item."orderId"
      WHERE order_record."organizationId" = ${organization.id}
        AND order_record."storeId" = ${store.id}
        AND order_record."status" IN (
          ${OrderStatus.PAID}::"OrderStatus",
          ${OrderStatus.PARTIALLY_REFUNDED}::"OrderStatus",
          ${OrderStatus.REFUNDED}::"OrderStatus"
        )
        AND order_record."createdAt" >= ${since}
      GROUP BY item."productName", item."sku"
      ORDER BY SUM(item."quantity") DESC, SUM(item."lineTotal") DESC
      LIMIT 10
    `),
    prisma.$queryRaw<SalesTrendBucket[]>(buildSalesTrendQuery({
      organizationId: organization.id,
      storeId: store.id,
      timezone: organization.timezone,
      since,
      now,
      days,
    })),
    prisma.$queryRaw<SupplierPerformanceRow[]>(Prisma.sql`
      SELECT supplier."id" AS "supplierId",
        supplier."businessName" AS "supplierName",
        COUNT(DISTINCT purchase_order."id") FILTER (
          WHERE purchase_order."status" <> 'CANCELLED'::"PurchaseOrderStatus"
        )::bigint AS "orderCount",
        COUNT(DISTINCT purchase_order."id") FILTER (
          WHERE purchase_order."status" = 'RECEIVED'::"PurchaseOrderStatus"
        )::bigint AS "completedOrderCount",
        COALESCE(SUM(item."orderedQuantity") FILTER (
          WHERE purchase_order."status" <> 'CANCELLED'::"PurchaseOrderStatus"
        ), 0)::bigint AS "unitsOrdered",
        COALESCE(SUM(item."receivedQuantity") FILTER (
          WHERE purchase_order."status" <> 'CANCELLED'::"PurchaseOrderStatus"
        ), 0)::bigint AS "unitsReceived",
        COALESCE(SUM(item."receivedQuantity" * item."unitCost") FILTER (
          WHERE purchase_order."status" <> 'CANCELLED'::"PurchaseOrderStatus"
        ), 0)::numeric AS "receivedValue"
      FROM "PurchaseOrder" AS purchase_order
      INNER JOIN "Supplier" AS supplier
        ON supplier."id" = purchase_order."supplierId"
        AND supplier."organizationId" = purchase_order."organizationId"
      LEFT JOIN "PurchaseOrderItem" AS item
        ON item."purchaseOrderId" = purchase_order."id"
      WHERE purchase_order."organizationId" = ${organization.id}
        AND purchase_order."storeId" = ${store.id}
        AND purchase_order."createdAt" >= ${since}
      GROUP BY supplier."id", supplier."businessName"
      ORDER BY "receivedValue" DESC, "orderCount" DESC, supplier."businessName" ASC
      LIMIT 10
    `),
    prisma.$queryRaw<CustomerRetentionBucket[]>(Prisma.sql`
      SELECT COUNT(order_record."id")::bigint AS "orderCount",
        COALESCE(SUM(order_record."total" - refund_totals.amount), 0)::numeric AS "netSpend"
      FROM "Customer" AS customer
      INNER JOIN "Order" AS order_record
        ON order_record."customerId" = customer."id"
        AND order_record."organizationId" = customer."organizationId"
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(refund."amount"), 0)::numeric AS amount
        FROM "Refund" AS refund
        WHERE refund."orderId" = order_record."id"
      ) AS refund_totals ON true
      WHERE customer."organizationId" = ${organization.id}
        AND order_record."storeId" = ${store.id}
        AND order_record."createdAt" >= ${since}
        AND order_record."status" IN (
          ${OrderStatus.PAID}::"OrderStatus",
          ${OrderStatus.PARTIALLY_REFUNDED}::"OrderStatus",
          ${OrderStatus.REFUNDED}::"OrderStatus"
        )
      GROUP BY customer."id"
    `),
    supplierInvoiceAgingPromise,
  ]);
  const grossSales = paidSales._sum.total ?? new Prisma.Decimal(0);
  const refundTotal = refunds._sum.amount ?? new Prisma.Decimal(0);
  const salesTotal = grossSales.minus(refundTotal).toString();
  const paidOrderCount = paidSales._count._all;
  const customerRetention = calculateCustomerRetentionMetrics(customerRetentionRows);
  const averageOrder = paidOrderCount > 0
    ? formatGhanaCedis((Number(salesTotal) / paidOrderCount).toFixed(2))
    : formatGhanaCedis("0");
  const maxPeriodRevenue = Math.max(...salesOverTime.map((period) => Number(period.revenue)), 0);
  const supplierInvoiceAgingTotals = summarizeSupplierInvoiceAging(supplierInvoiceAging);
  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    month: "short",
    day: "numeric",
    timeZone: organization.timezone,
  });

  return (
    <WorkspaceShell
      activeSection="reports"
      membershipId={membership.id}
      organizationId={organization.id}
      currency={organization.currency}
      organizationName={organization.name}
      role={membership.role}
      storeId={store.id}
      storeName={store.name}
      userName={session.user.name ?? session.user.email ?? "User"}
    >
      <header className="workspace-header">
        <div>
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Reports</p>
          <h1>Reports &amp; insights</h1>
          <p className="header-note">Sales and payment activity for {store.name}, based on saved transactions.</p>
        </div>
        <div className="header-store">{getPeriodLabel(days)}<span>Ghana · {organization.currency}</span></div>
      </header>

      <form className="report-period-form" action="/reports" method="get">
        <label htmlFor="report-days">Reporting period</label>
        <select id="report-days" name="days" defaultValue={String(days)}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <button className="button-primary" type="submit">Update report</button>
        <a className="report-export-link" href={`/reports/export?days=${days}`}>Download sales CSV</a>
        {canManageSupplierInvoices(membership.role) && <a className="report-export-link" href={`/reports/accounting-export?days=${days}`}>Download sales &amp; refunds export</a>}
        {canManageSupplierInvoices(membership.role) && <a className="report-export-link" href={`/reports/tax-export?days=${days}`}>Download tax snapshots</a>}
        {canManageSupplierInvoices(membership.role) && <a className="report-export-link" href="/reports/supplier-invoice-aging">Download supplier invoice aging CSV</a>}
        {canManageSupplierInvoices(membership.role) && <a className="report-export-link" href="/reports/supplier-invoice-aging?detail=invoices">Download invoice aging details</a>}
        <span>Orders created from {new Intl.DateTimeFormat("en-GH", {
          dateStyle: "medium",
          timeZone: organization.timezone,
        }).format(since)}</span>
      </form>
      {canManageSupplierInvoices(membership.role) && (
        <p className="register-shift-disclaimer">Exports are operational summaries, not a general ledger or tax filing. Tax snapshots show the saved combined rate, VAT/NHIL/GETFund component snapshots and item tax treatments from each sale (orders before component tracking show combined tax only); refunds are listed separately because refund tax allocations are not stored. Review source receipts and current tax guidance before filing; this is not tax advice or a compliance statement (see <a href="https://gra.gov.gh/domestic-tax/tax-types/vat/" target="_blank" rel="noreferrer">GRA</a>).</p>
      )}

      <div className="section-heading">
        <div><p className="eyebrow">Store performance</p><h2>{getPeriodLabel(days)}</h2></div>
        <span className="data-source-note">Live transaction data</span>
      </div>
      <section className="metric-grid" aria-label="Sales report summary">
        <article className="metric-card"><p>Net sales</p><strong>{formatGhanaCedis(salesTotal)}</strong><span>Completed sales less recorded refunds</span></article>
        <article className="metric-card"><p>Paid orders</p><strong>{paidOrderCount.toLocaleString("en-GH")}</strong><span>Completed sales, including refunded orders</span></article>
        <article className="metric-card"><p>Cash refunded</p><strong>{formatGhanaCedis(refundTotal.toString())}</strong><span>Recorded refunds on sales in this period</span></article>
        <article className="metric-card"><p>Average net order</p><strong>{averageOrder}</strong><span>Net sales divided by completed sales</span></article>
        <article className="metric-card"><p>All orders</p><strong>{orderCount.toLocaleString("en-GH")}</strong><span>Including open and cancelled orders</span></article>
      </section>

      <section className="report-panel sales-trend-panel" aria-labelledby="sales-trend-heading">
        <div className="report-panel-heading">
          <div><p className="eyebrow">Revenue trend</p><h2 id="sales-trend-heading">Net sales over time</h2></div>
          <span>{days === 7 ? "Daily" : "Weekly"} · {organization.currency}</span>
        </div>
        {paidOrderCount > 0 ? (
          <div className="sales-trend-chart" role="img" aria-label={`Net sales chart for the last ${days} days`}>
            {salesOverTime.map((period) => {
              const revenue = Number(period.revenue);
              const height = maxPeriodRevenue > 0 ? Math.max((revenue / maxPeriodRevenue) * 100, 3) : 0;
              const date = new Date(`${period.period}T12:00:00.000Z`);
              return (
                <div className="sales-trend-column" key={period.period} title={`${period.period}: ${formatGhanaCedis(period.revenue.toString())}`}>
                  <span className="sales-trend-value">{formatGhanaCedis(period.revenue.toString())}</span>
                  <div className="sales-trend-bar-track"><span className="sales-trend-bar" style={{ height: `${height}%` }} /></div>
                  <span className="sales-trend-label">{dateFormatter.format(date)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="report-empty">No paid sales were recorded in this period.</p>
        )}
      </section>

      <section className="report-panel supplier-performance-panel" aria-labelledby="supplier-performance-heading">
        <div className="report-panel-heading">
          <div><p className="eyebrow">Supplier purchasing</p><h2 id="supplier-performance-heading">Supplier performance</h2></div>
          <span>{getPeriodLabel(days)} · received inventory value</span>
        </div>
        {supplierPerformance.length ? (
          <div className="table-scroll">
            <table className="data-table operational-table">
              <thead>
                <tr><th>Supplier</th><th>Orders completed</th><th>Units received</th><th>Received value</th></tr>
              </thead>
              <tbody>
                {supplierPerformance.map((supplier) => {
                  const completionRate = supplier.orderCount > 0n
                    ? (supplier.completedOrderCount * 100n + supplier.orderCount / 2n) / supplier.orderCount
                    : 0n;
                  return (
                    <tr key={supplier.supplierId}>
                      <td><strong>{supplier.supplierName}</strong></td>
                      <td>{supplier.completedOrderCount.toLocaleString("en-GH")} / {supplier.orderCount.toLocaleString("en-GH")} <small className="table-secondary">({completionRate.toLocaleString("en-GH")}% complete)</small></td>
                      <td>{supplier.unitsReceived.toLocaleString("en-GH")} / {supplier.unitsOrdered.toLocaleString("en-GH")}</td>
                      <td>{formatGhanaCedis(supplier.receivedValue.toString())}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="report-empty">Supplier performance will appear after purchase orders are created in this period.</p>}
      </section>

      {canManageSupplierInvoices(membership.role) && (
        <section className="report-panel supplier-aging-panel" aria-labelledby="supplier-aging-heading">
          <div className="report-panel-heading">
            <div><p className="eyebrow">Supplier purchasing</p><h2 id="supplier-aging-heading">Outstanding invoice aging</h2></div>
            <span>As of {new Intl.DateTimeFormat("en-GH", {
              dateStyle: "medium",
              timeZone: organization.timezone,
            }).format(businessDateStart)} · {store.name}</span>
          </div>
          {supplierInvoiceAging.length > 0 ? (
            <div className="table-scroll">
              <table className="data-table operational-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>No due date</th>
                    <th>Current</th>
                    <th>1–30 days overdue</th>
                    <th>31–60 days overdue</th>
                    <th>61+ days overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierInvoiceAging.map((supplier) => (
                    <tr key={supplier.supplierId}>
                      <td><strong>{supplier.supplierName}</strong></td>
                      <td>{formatGhanaCedis(supplier.undatedBalance)}<small className="table-secondary">{supplier.undatedCount.toLocaleString("en-GH")} invoices</small></td>
                      <td>{formatGhanaCedis(supplier.currentBalance)}<small className="table-secondary">{supplier.currentCount.toLocaleString("en-GH")} invoices</small></td>
                      <td>{formatGhanaCedis(supplier.overdue1To30Balance)}<small className="table-secondary">{supplier.overdue1To30Count.toLocaleString("en-GH")} invoices</small></td>
                      <td>{formatGhanaCedis(supplier.overdue31To60Balance)}<small className="table-secondary">{supplier.overdue31To60Count.toLocaleString("en-GH")} invoices</small></td>
                      <td>{formatGhanaCedis(supplier.overdue61PlusBalance)}<small className="table-secondary">{supplier.overdue61PlusCount.toLocaleString("en-GH")} invoices</small></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <td>{formatGhanaCedis(supplierInvoiceAgingTotals.undatedBalance)}<small className="table-secondary">{supplierInvoiceAgingTotals.undatedCount.toLocaleString("en-GH")} invoices</small></td>
                    <td>{formatGhanaCedis(supplierInvoiceAgingTotals.currentBalance)}<small className="table-secondary">{supplierInvoiceAgingTotals.currentCount.toLocaleString("en-GH")} invoices</small></td>
                    <td>{formatGhanaCedis(supplierInvoiceAgingTotals.overdue1To30Balance)}<small className="table-secondary">{supplierInvoiceAgingTotals.overdue1To30Count.toLocaleString("en-GH")} invoices</small></td>
                    <td>{formatGhanaCedis(supplierInvoiceAgingTotals.overdue31To60Balance)}<small className="table-secondary">{supplierInvoiceAgingTotals.overdue31To60Count.toLocaleString("en-GH")} invoices</small></td>
                    <td>{formatGhanaCedis(supplierInvoiceAgingTotals.overdue61PlusBalance)}<small className="table-secondary">{supplierInvoiceAgingTotals.overdue61PlusCount.toLocaleString("en-GH")} invoices</small></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : <p className="report-empty">No outstanding supplier invoices were found for this store.</p>}
          <p className="report-disclaimer">Current and overdue aging use invoice due dates; invoices without a due date are shown separately. Balances use recorded payments and supplier credits. This is an operational estimate, not an accounting statement or payment instruction.</p>
        </section>
      )}

      <div className="reports-detail-grid">
        <section className="report-panel" aria-labelledby="top-products-heading">
          <div className="report-panel-heading">
            <div><p className="eyebrow">Product mix</p><h2 id="top-products-heading">Top products</h2></div>
            <span>Paid orders · item sales</span>
          </div>
          {topProducts.length ? (
            <ol className="report-ranked-list">
              {topProducts.map((product, index) => (
                <li key={`${product.sku}-${product.productName}`}>
                  <span className="report-rank">{index + 1}</span>
                  <span className="report-product-name"><strong>{product.productName}</strong><small>{product.sku} · {Number(product.unitsSold).toLocaleString("en-GH")} sold</small></span>
                  <strong className="report-list-value" title="Item sales before order-level adjustments">{formatGhanaCedis(product.revenue.toString())}</strong>
                </li>
              ))}
            </ol>
          ) : <p className="report-empty">Product sales will appear after paid orders are recorded.</p>}
        </section>

        <section className="report-panel" aria-labelledby="payment-methods-heading">
          <div className="report-panel-heading">
            <div><p className="eyebrow">Tender mix</p><h2 id="payment-methods-heading">Payment methods</h2></div>
            <span>Gross tender recorded; refunds are summarized above</span>
          </div>
          {paymentsByMethod.length ? (
            <ul className="report-payment-list">
              {paymentsByMethod.map((payment) => (
                <li key={payment.method}>
                  <span><strong>{paymentMethodLabels[payment.method]}</strong><small>{payment._count._all.toLocaleString("en-GH")} successful {payment._count._all === 1 ? "payment" : "payments"}</small></span>
                  <strong>{formatGhanaCedis(payment._sum.amount?.toString() ?? "0")}</strong>
                </li>
              ))}
            </ul>
          ) : <p className="report-empty">Payment totals will appear when payments are recorded.</p>}
        </section>
      </div>

      <section className="report-panel order-status-panel" aria-labelledby="order-status-heading">
        <div className="report-panel-heading">
          <div><p className="eyebrow">Order activity</p><h2 id="order-status-heading">Order status breakdown</h2></div>
          <span>Orders created in this period</span>
        </div>
        {ordersByStatus.length ? (
          <div className="order-status-breakdown">
            {ordersByStatus.map((row) => (
              <div className="order-status-tile" key={row.status}>
                <span className={`order-status order-status-${row.status.toLowerCase()}`}>{row.status.replaceAll("_", " ")}</span>
                <strong>{row._count._all.toLocaleString("en-GH")}</strong>
              </div>
            ))}
          </div>
        ) : <p className="report-empty">No orders were created in this period.</p>}
      </section>

      <section className="report-panel customer-retention-panel" aria-labelledby="customer-retention-heading">
        <div className="report-panel-heading">
          <div><p className="eyebrow">Customer activity</p><h2 id="customer-retention-heading">Repeat customer activity</h2></div>
          <span>{getPeriodLabel(days)} · completed sales</span>
        </div>
        <div className="customer-retention-metrics">
          <div><span>Customers with a completed sale</span><strong>{customerRetention.activeCustomerCount.toLocaleString("en-GH")}</strong></div>
          <div><span>Customers with 2+ sales</span><strong>{customerRetention.repeatCustomerCount.toLocaleString("en-GH")} <small>({customerRetention.repeatCustomerRate.toFixed(2)}%)</small></strong></div>
          <div><span>Net sales from repeat customers</span><strong>{formatGhanaCedis(customerRetention.repeatCustomerNetSales.toString())}</strong></div>
        </div>
        <p className="report-disclaimer">Walk-in sales are excluded. Refunds reduce customer net spend; this is a store-level activity measure, not a cross-store customer lifetime value calculation.</p>
      </section>

      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
