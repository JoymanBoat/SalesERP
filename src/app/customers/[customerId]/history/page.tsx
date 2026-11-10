import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatus, Prisma } from "@prisma/client";

import { WorkspaceShell } from "@/components/workspace-shell";
import { getPageCount, parsePage } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

const pageSize = 20;

export default async function CustomerHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { session, membership, organization, store } = await getWorkspace({ feature: "customers", operation: "view" });
  const [{ customerId }, { page: rawPage }] = await Promise.all([params, searchParams]);
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId: organization.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      archivedAt: true,
      loyaltyPoints: true,
    },
  });
  if (!customer) notFound();

  const orderWhere = { organizationId: organization.id, customerId: customer.id };
  const [totalOrders, paidSummary, refundSummary, loyaltyTransactions] = await Promise.all([
    prisma.order.count({ where: orderWhere }),
    prisma.order.aggregate({
      where: { ...orderWhere, status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED] } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.refund.aggregate({
      where: { organizationId: organization.id, order: { customerId: customer.id } },
      _sum: { amount: true },
    }),
    prisma.customerLoyaltyTransaction.findMany({
      where: { organizationId: organization.id, customerId: customer.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      select: { id: true, type: true, pointsDelta: true, reason: true, createdAt: true },
    }),
  ]);
  const netSpend = (paidSummary._sum.total ?? new Prisma.Decimal(0))
    .minus(refundSummary._sum.amount ?? new Prisma.Decimal(0));
  const pageCount = getPageCount(totalOrders, pageSize);
  const page = Math.min(parsePage(rawPage), pageCount);
  const orders = await prisma.order.findMany({
    where: orderWhere,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      store: { select: { name: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          productName: true,
          sku: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
        },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        select: { id: true, method: true, status: true, amount: true },
      },
    },
  });
  const name = `${customer.firstName}${customer.lastName ? ` ${customer.lastName}` : ""}`;
  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: organization.timezone,
  });
  const pageHref = (target: number) => `/customers/${customer.id}/history?page=${target}`;

  return (
    <WorkspaceShell
      activeSection="customers"
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
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / <Link href="/customers">Customers</Link> / History</p>
          <h1>{name}</h1>
          <p className="header-note">Complete recorded order history for this customer.</p>
        </div>
        <Link className="customer-filter-link" href="/customers">Back to customers</Link>
      </header>

      <section className="customer-history-summary" aria-label="Customer purchase summary">
        <div><span>Contact</span><strong>{customer.email ?? customer.phone ?? "No contact details"}</strong>{customer.email && customer.phone && <small>{customer.phone}</small>}</div>
        <div><span>All orders</span><strong>{totalOrders.toLocaleString("en-GH")}</strong></div>
        <div><span>Paid orders</span><strong>{paidSummary._count._all.toLocaleString("en-GH")}</strong></div>
        <div><span>Net spend · {organization.currency}</span><strong>{organization.currency} {Number(netSpend).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
        <div><span>Loyalty balance</span><strong>{customer.loyaltyPoints.toLocaleString("en-GH")} points</strong><small>100 points = {organization.currency} 1</small></div>
      </section>
      {customer.archivedAt && <p className="customer-history-archived" role="status">This customer is inactive. Historical orders remain available.</p>}

      <section className="data-panel customer-loyalty-history" aria-labelledby="loyalty-history-heading">
        <div className="panel-title-row"><div><h2 id="loyalty-history-heading">Loyalty activity</h2><p>One point per full {organization.currency} 1 paid. Refunds adjust points proportionally.</p></div><span className="table-count">{customer.loyaltyPoints.toLocaleString("en-GH")} points</span></div>
        <div className="table-scroll">
          <table className="data-table operational-table">
            <thead><tr><th>Date</th><th>Activity</th><th>Points</th></tr></thead>
            <tbody>
              {loyaltyTransactions.map((entry) => (
                <tr key={entry.id}>
                  <td>{dateFormatter.format(entry.createdAt)}</td>
                  <td>{entry.reason}</td>
                  <td>{entry.pointsDelta > 0n ? "+" : ""}{entry.pointsDelta.toLocaleString("en-GH")}</td>
                </tr>
              ))}
              {loyaltyTransactions.length === 0 && <tr><td className="table-empty" colSpan={3}>No loyalty activity yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="section-heading">
        <div><p className="eyebrow">Transaction archive</p><h2>Purchase history</h2></div>
        <span className="data-source-note">
          {totalOrders === 0 ? "No orders" : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalOrders)} of ${totalOrders}`}
        </span>
      </div>

      {orders.length ? (
        <section className="customer-full-history" aria-label="Customer order history">
          {orders.map((order) => (
            <article className="customer-full-order" key={order.id}>
              <header className="customer-full-order-header">
                <div>
                  <strong>Order #{order.number}</strong>
                  <span>{dateFormatter.format(order.createdAt)} · {order.store.name}</span>
                </div>
                <div>
                  <span className={`order-status order-status-${order.status.toLowerCase()}`}>{order.status.replaceAll("_", " ")}</span>
                  <strong>{order.currency} {Number(order.total).toFixed(2)}</strong>
                </div>
              </header>
              {order.items.length ? (
                <ul className="customer-order-items">
                  {order.items.map((item) => (
                    <li key={item.id}>
                      <span>{item.productName}<small>{item.sku} · {item.quantity} × {order.currency} {Number(item.unitPrice).toFixed(2)}</small></span>
                      <strong>{order.currency} {Number(item.lineTotal).toFixed(2)}</strong>
                    </li>
                  ))}
                </ul>
              ) : <p className="customer-order-meta">No item details recorded.</p>}
              {order.payments.length > 0 ? (
                <ul className="customer-payment-list">
                  {order.payments.map((payment) => (
                    <li key={payment.id}>
                      {payment.method.replaceAll("_", " ")} · {payment.status.replaceAll("_", " ")}
                      <strong>{order.currency} {Number(payment.amount).toFixed(2)}</strong>
                    </li>
                  ))}
                </ul>
              ) : <p className="customer-order-meta">No payment records.</p>}
            </article>
          ))}
        </section>
      ) : (
        <section className="data-panel customer-full-history-empty">
          <h2>No recorded orders</h2>
          <p>Orders for this customer will appear here when recorded.</p>
        </section>
      )}

      {pageCount > 1 && (
        <nav className="customer-history-pagination" aria-label="Customer history pages">
          {page > 1 ? <Link className="button-quiet" href={pageHref(page - 1)}>Previous</Link> : <span className="button-quiet pagination-disabled">Previous</span>}
          <span>Page {page} of {pageCount}</span>
          {page < pageCount ? <Link className="button-quiet" href={pageHref(page + 1)}>Next</Link> : <span className="button-quiet pagination-disabled">Next</span>}
        </nav>
      )}

      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
