import Link from "next/link";
import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";

import { TransactionActions } from "@/components/transaction-actions";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canManagePricing } from "@/lib/permissions";
import { getPageCount, parsePage } from "@/lib/pagination";
import { formatGhanaCedis } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

const pageSize = 25;

export default async function PosTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { session, membership, organization, store } = await getWorkspace({ feature: "pos", operation: "view" });
  const { q = "", page: rawPage } = await searchParams;
  const query = q.trim().slice(0, 80);
  const parsedOrderNumber = /^\d+$/.test(query) ? Number(query) : undefined;
  const where: Prisma.OrderWhereInput = {
    organizationId: organization.id,
    storeId: store.id,
    status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED, OrderStatus.CANCELLED] },
    ...(query ? {
      OR: [
        ...(parsedOrderNumber && Number.isSafeInteger(parsedOrderNumber) ? [{ number: parsedOrderNumber }] : []),
        { items: { some: { productName: { contains: query, mode: "insensitive" } } } },
        { items: { some: { sku: { contains: query, mode: "insensitive" } } } },
        { customer: { is: { firstName: { contains: query, mode: "insensitive" } } } },
        { customer: { is: { lastName: { contains: query, mode: "insensitive" } } } },
      ],
    } : {}),
  };
  const count = await prisma.order.count({ where });
  const pageCount = getPageCount(count, pageSize);
  const page = Math.min(parsePage(rawPage), pageCount);
  const orders = await prisma.order.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      customer: { select: { firstName: true, lastName: true } },
      items: {
        include: {
          variant: { select: { trackInventory: true } },
          returns: { include: { saleReturn: { select: { id: true } } } },
        },
      },
      payments: { where: { status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED] } } },
      refunds: { select: { amount: true } },
    },
  });
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (target > 1) params.set("page", String(target));
    const qs = params.toString();
    return qs ? `/pos/transactions?${qs}` : "/pos/transactions";
  };
  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: organization.timezone,
  });

  return (
    <WorkspaceShell
      activeSection="pos"
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
          <p className="breadcrumbs"><Link href="/pos">Point of sale</Link> / Transactions</p>
          <h1>Transaction history</h1>
          <p className="header-note">Completed, refunded, returned, and voided sales for {store.name}.</p>
        </div>
        <div className="header-store">{count.toLocaleString("en-GH")} records<span>Store transactions</span></div>
      </header>

      <form className="search-form transaction-search" action="/pos/transactions" method="get" role="search">
        <label className="visually-hidden" htmlFor="transaction-search-input">Search transactions by number, item, SKU, or customer</label>
        <input id="transaction-search-input" name="q" defaultValue={query} maxLength={80} placeholder="Search sale number, item, SKU, or customer" />
        <button className="button-quiet" type="submit">Search</button>
      </form>

      <section className="transaction-list" aria-label="Sales transactions">
        {orders.map((order) => {
          const refundedTotal = order.refunds.reduce((total, refund) => total.plus(refund.amount), new Prisma.Decimal(0));
          const paymentSummary = order.payments
            .map((payment) => `${payment.method.replaceAll("_", " ")} ${formatGhanaCedis(payment.amount.toString())}`)
            .join(" + ");
          const paymentStatus = order.payments[0]?.status;
          const returnedByItem = new Map<string, number>();
          for (const item of order.items) {
            returnedByItem.set(item.id, item.returns.reduce((total, returned) => total + returned.quantity, 0));
          }
          return (
            <article className="data-panel transaction-card" key={order.id}>
              <header className="purchase-order-header">
                <div>
                  <strong>Sale #{order.number} · {order.customer ? `${order.customer.firstName} ${order.customer.lastName ?? ""}`.trim() : "Walk-in"}</strong>
                  <span>{dateFormatter.format(order.createdAt)} · {paymentSummary || "No payment"}{paymentStatus ? ` · ${paymentStatus.replaceAll("_", " ")}` : ""}</span>
                </div>
                <div className="purchase-order-total">
                  <span className={`order-status order-status-${order.status.toLowerCase()}`}>{order.status.replaceAll("_", " ")}</span>
                  <strong>{formatGhanaCedis(order.total.toString())}</strong>
                </div>
              </header>
              <div className="transaction-card-summary">
                <span>Subtotal {formatGhanaCedis(order.subtotal.toString())}</span>
                <span>Discount{order.promotionCode ? ` · ${order.promotionCode}` : ""} −{formatGhanaCedis(order.discountTotal.toString())}</span>
                <span>Tax {formatGhanaCedis(order.taxTotal.toString())}</span>
                <span>Refunded {formatGhanaCedis(refundedTotal.toString())}</span>
                {order.loyaltyPointsRedeemed > 0n && <span>Points redeemed {order.loyaltyPointsRedeemed.toLocaleString("en-GH")}</span>}
                {order.loyaltyPointsEarned > 0n && <span>Points earned {order.loyaltyPointsEarned.toLocaleString("en-GH")}</span>}
              </div>
              <div className="transaction-line-list">
                {order.items.map((item) => (
                  <div key={item.id}>
                    <span>{item.productName} · {item.sku} × {item.quantity}</span>
                    <small>{formatGhanaCedis(item.lineTotal.toString())} · {returnedByItem.get(item.id) ?? 0} returned</small>
                  </div>
                ))}
              </div>
              <div className="transaction-card-links">
                <Link className="button-quiet" href={`/pos/receipt/${order.id}`}>Receipt</Link>
              </div>
              <TransactionActions
                orderId={order.id}
                orderTotal={order.total.toString()}
                refundedTotal={refundedTotal.toString()}
                items={order.items.map((item) => ({
                  itemId: item.id,
                  quantity: item.quantity,
                  remaining: item.quantity - (returnedByItem.get(item.id) ?? 0),
                  productName: item.productName,
                  sku: item.sku,
                  trackInventory: Boolean(item.variant?.trackInventory),
                }))}
                canManage={canManagePricing(membership.role) && (order.status === OrderStatus.PAID || order.status === OrderStatus.PARTIALLY_REFUNDED)}
              />
            </article>
          );
        })}
        {orders.length === 0 && <p className="report-empty">{query ? "No transactions match the search." : "Completed POS sales will appear here."}</p>}
      </section>

      {pageCount > 1 && (
        <nav className="customer-directory-pagination transaction-pagination" aria-label="Transaction pages">
          <span>Page {page} of {pageCount}</span>
          <div>
            {page > 1 ? <Link className="button-quiet" href={pageHref(page - 1)}>Previous</Link> : <span className="button-quiet pagination-disabled">Previous</span>}
            <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, count)} of {count}</span>
            {page < pageCount ? <Link className="button-quiet" href={pageHref(page + 1)}>Next</Link> : <span className="button-quiet pagination-disabled">Next</span>}
          </div>
        </nav>
      )}
      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
