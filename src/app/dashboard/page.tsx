import { Prisma } from "@prisma/client";
import Link from "next/link";

import { WorkspaceShell } from "@/components/workspace-shell";
import { formatGhanaCedis } from "@/lib/currency";
import { canManageSupplierInvoices } from "@/lib/permissions";
import { businessDateInTimeZone } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { getSupplierInvoiceReminderSummary } from "@/lib/supplier-invoice-reminders";
import { canUseSubscriptionFeature } from "@/lib/subscription-policy";
import { getWorkspace } from "@/lib/workspace";

function getThirtyDayWindowStart() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ storeError?: string; workspaceError?: string }>;
}) {
  const { session, membership, organization, store, subscription } = await getWorkspace({ operation: "view" });
  const { storeError, workspaceError } = await searchParams;
  const organizationId = organization.id;
  const since = getThirtyDayWindowStart();
  const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
  const now = new Date();
  const hasPos = canUseSubscriptionFeature(subscription, "pos", "view", now);
  const hasInventory = canUseSubscriptionFeature(subscription, "inventory", "view", now);
  const hasCustomers = canUseSubscriptionFeature(subscription, "customers", "view", now);
  const hasPurchasing = canUseSubscriptionFeature(subscription, "purchasing", "view", now);
  const invoiceReminderSummaryPromise = hasPurchasing && canManageSupplierInvoices(membership.role)
    ? getSupplierInvoiceReminderSummary(organization.id, store.id, businessDate)
    : Promise.resolve(null);
  const [productCount, customerCount, lowStockRows, paidOrders, refunds, orderCount, invoiceReminderSummary] = await Promise.all([
    hasInventory ? prisma.product.count({ where: { organizationId, archivedAt: null } }) : Promise.resolve(null),
    hasCustomers ? prisma.customer.count({ where: { organizationId } }) : Promise.resolve(null),
    hasInventory ? prisma.$queryRaw<{
      id: string;
      productName: string;
      variantName: string;
      sku: string;
      quantity: number;
      reserved: number;
      reorderPoint: number;
      total: bigint;
    }[]>(Prisma.sql`
      SELECT
        variant."id",
        product."name" AS "productName",
        variant."name" AS "variantName",
        variant."sku",
        level."quantity",
        level."reserved",
        level."reorderPoint",
        COUNT(*) OVER()::bigint AS "total"
      FROM "InventoryLevel" AS level
      INNER JOIN "ProductVariant" AS variant ON variant."id" = level."variantId"
      INNER JOIN "Product" AS product ON product."id" = variant."productId"
      WHERE level."organizationId" = ${organizationId}
        AND level."storeId" = ${store.id}
        AND product."archivedAt" IS NULL
        AND level."quantity" <= level."reorderPoint"
      ORDER BY level."quantity" ASC, product."name" ASC, variant."name" ASC
      LIMIT 5
    `) : Promise.resolve([]),
    hasPos ? prisma.order.aggregate({
      where: {
        organizationId,
        storeId: store.id,
        status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] },
        createdAt: { gte: since },
      },
      _sum: { total: true },
      _count: { _all: true },
    }) : Promise.resolve(null),
    hasPos ? prisma.refund.aggregate({
      where: { organizationId, storeId: store.id, order: { createdAt: { gte: since } } },
      _sum: { amount: true },
    }) : Promise.resolve(null),
    hasPos ? prisma.order.count({ where: { organizationId, storeId: store.id, createdAt: { gte: since } } }) : Promise.resolve(null),
    invoiceReminderSummaryPromise,
  ]);
  const lowStockCount = Number(lowStockRows[0]?.total ?? 0n);
  const grossSales = paidOrders?._sum.total ?? new Prisma.Decimal(0);
  const refundedSales = refunds?._sum.amount ?? new Prisma.Decimal(0);
  const netSales = grossSales.minus(refundedSales);

  return (
    <WorkspaceShell
      activeSection="overview"
      membershipId={membership.id}
      organizationId={organization.id}
      currency={organization.currency}
      organizationName={organization.name}
      role={membership.role}
      storeId={store.id}
      storeName={store.name}
      userName={session.user.name ?? session.user.email ?? "User"}
    >
        {workspaceError && <p className="form-error store-selection-error" role="alert">
          {workspaceError === "unavailable"
            ? "You no longer have access to that business. Your current business was restored."
            : workspaceError === "stale"
              ? "This page was open before your business changed. Refresh it and try again."
              : "Select a business you belong to."}
        </p>}
        {storeError && <p className="form-error store-selection-error" role="alert">
          {storeError === "unavailable"
            ? "That store is no longer active or does not belong to this organization."
            : "Select a valid active store."}
        </p>}
        <header className="workspace-header">
          <div>
            <p className="breadcrumbs">Workspace / Overview</p>
            <h1>Good morning, {session.user.name?.split(" ")[0] ?? "there"}</h1>
            <p className="header-note">Here is your business at a glance.</p>
          </div>
          <div className="header-store">{store.name}<span>Ghana · {organization.currency}</span></div>
        </header>
        <div className="section-heading">
          <div><p className="eyebrow">Business overview</p><h2>Last 30 days</h2></div>
          <span className="data-source-note">Live data from your workspace</span>
        </div>
        <section className="metric-grid" aria-label="Business metrics">
          {hasPos && <>
            <article className="metric-card"><p>Net sales</p><strong>{formatGhanaCedis(netSales.toString())}</strong><span>Completed sales less refunds, last 30 days</span></article>
            <article className="metric-card"><p>Cash refunded</p><strong>{formatGhanaCedis(refundedSales.toString())}</strong><span>Refunds on sales from this period</span></article>
            <article className="metric-card"><p>Orders</p><strong>{orderCount?.toLocaleString("en-GH")}</strong><span>Created in the last 30 days</span></article>
          </>}
          {hasInventory && <article className="metric-card"><p>Active products</p><strong>{productCount?.toLocaleString("en-GH")}</strong><span>Across your business</span></article>}
          {hasCustomers && <article className="metric-card"><p>Customers</p><strong>{customerCount?.toLocaleString("en-GH")}</strong><span>Customer records</span></article>}
        </section>
        {hasPurchasing && invoiceReminderSummary && (invoiceReminderSummary.overdueCount > 0 || invoiceReminderSummary.dueSoonCount > 0 || invoiceReminderSummary.noDueDateCount > 0) && (
          <section className="data-panel dashboard-stock-panel" aria-labelledby="dashboard-payables-heading">
            <div className="panel-title-row">
              <div>
                <h2 id="dashboard-payables-heading">Supplier invoices to review</h2>
                <p>Recorded outstanding balances for {store.name}; operational tracking, not an accounting statement.</p>
              </div>
              <Link className="report-export-link" href="/purchasing">View purchasing</Link>
            </div>
            <ul className="dashboard-stock-list">
              {invoiceReminderSummary.overdueCount > 0 && (
                <li>
                  <div><strong>Past due</strong><small>{invoiceReminderSummary.overdueCount.toLocaleString("en-GH")} outstanding invoices</small></div>
                  <span>{formatGhanaCedis(invoiceReminderSummary.overdueBalance)}</span>
                  <Link href="/purchasing?status=INVOICE_OVERDUE">Review past-due invoices</Link>
                </li>
              )}
              {invoiceReminderSummary.dueSoonCount > 0 && (
                <li>
                  <div><strong>Due within 7 days</strong><small>{invoiceReminderSummary.dueSoonCount.toLocaleString("en-GH")} outstanding invoices</small></div>
                  <span>{formatGhanaCedis(invoiceReminderSummary.dueSoonBalance)}</span>
                  <Link href="/purchasing?status=INVOICE_DUE_SOON">Review upcoming invoices</Link>
                </li>
              )}
              {invoiceReminderSummary.noDueDateCount > 0 && (
                <li>
                  <div><strong>Missing due date</strong><small>{invoiceReminderSummary.noDueDateCount.toLocaleString("en-GH")} outstanding invoices</small></div>
                  <span>{formatGhanaCedis(invoiceReminderSummary.noDueDateBalance)}</span>
                  <Link href="/purchasing?status=INVOICE_NO_DUE_DATE">Add due dates in purchasing</Link>
                </li>
              )}
            </ul>
          </section>
        )}
        <section className="setup-panel">
          <div className="setup-copy">
            <p className="eyebrow">Your workspace is ready</p>
            <h2>Manage your business</h2>
            <p>Open the workspace areas available on your current plan.</p>
          </div>
          {hasInventory && <div className="stock-callout"><span className="stock-indicator" />{lowStockCount.toLocaleString("en-GH")} items at or below reorder point</div>}
        </section>
        {hasInventory && lowStockRows.length > 0 && (
          <section className="data-panel dashboard-stock-panel" aria-labelledby="dashboard-stock-heading">
            <div className="panel-title-row">
              <div><h2 id="dashboard-stock-heading">Restock attention</h2><p>Lowest stock levels in {store.name}, compared with each item’s reorder point.</p></div>
              <Link className="report-export-link" href="/inventory">View inventory</Link>
            </div>
            <ul className="dashboard-stock-list">
              {lowStockRows.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.productName}{item.variantName === "Default" ? "" : ` · ${item.variantName}`}</strong>
                    <small>{item.sku} · reorder at {item.reorderPoint}</small>
                  </div>
                  <span className={item.quantity === 0 ? "dashboard-stock-out" : ""}>
                    {item.quantity} on hand{item.reserved > 0 ? ` · ${item.reserved} reserved` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {lowStockCount > lowStockRows.length && (
              <p className="dashboard-stock-more">Showing {lowStockRows.length} of {lowStockCount} items needing restock.</p>
            )}
          </section>
        )}
        <div className="quick-links">
          {hasPos && <a className="button-primary quick-link" href="/pos">Open point of sale <span aria-hidden="true">→</span></a>}
          {hasInventory && <a className="button-primary quick-link" href="/products">Manage products <span aria-hidden="true">→</span></a>}
          {hasInventory && <a className="button-quiet quick-link" href="/inventory">View inventory <span aria-hidden="true">→</span></a>}
        </div>
        <footer className="workspace-footer">
          <span>{organization.name}</span>
          <span>Workspace currency: {organization.currency}</span>
        </footer>
    </WorkspaceShell>
  );
}
