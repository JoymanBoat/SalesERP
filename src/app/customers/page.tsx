import { OrderStatus, Prisma } from "@prisma/client";
import Link from "next/link";

import { CustomerForm } from "@/components/customer-form";
import { CustomerRow } from "@/components/customer-row";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canManageCustomers } from "@/lib/permissions";
import { getPageCount, parsePage } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

const pageSize = 25;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; notice?: string; page?: string }>;
}) {
  const { session, membership, organization, store } = await getWorkspace({ feature: "customers", operation: "view" });
  const { q = "", status, notice, page: rawPage } = await searchParams;
  const showInactive = status === "inactive";
  const query = q.trim().slice(0, 80);
  const where: Prisma.CustomerWhereInput = {
    organizationId: organization.id,
    archivedAt: showInactive ? { not: null } : null,
    ...(query
      ? {
          OR: [
            { firstName: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            { phone: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const customerCount = await prisma.customer.count({ where });
  const pageCount = getPageCount(customerCount, pageSize);
  const page = Math.min(parsePage(rawPage), pageCount);
  const customers = await prisma.customer.findMany({
    where,
    include: {
      orders: {
        where: { organizationId: organization.id },
        orderBy: { createdAt: "desc" },
        take: 10,
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
      },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  const purchaseStatsRows = customers.length
    ? await prisma.$queryRaw<{ customerId: string; orderCount: bigint; netSpend: Prisma.Decimal }[]>(Prisma.sql`
        SELECT sale."customerId",
          COUNT(sale."id")::bigint AS "orderCount",
          COALESCE(SUM(sale."total" - COALESCE(refunds.amount, 0)), 0)::numeric AS "netSpend"
        FROM "Order" AS sale
        LEFT JOIN (
          SELECT refund."orderId", SUM(refund."amount")::numeric AS amount
          FROM "Refund" AS refund
          GROUP BY refund."orderId"
        ) AS refunds ON refunds."orderId" = sale."id"
        WHERE sale."organizationId" = ${organization.id}
          AND sale."customerId" IN (${Prisma.join(customers.map((customer) => customer.id))})
          AND sale."status" IN (
            ${OrderStatus.PAID}::"OrderStatus",
            ${OrderStatus.PARTIALLY_REFUNDED}::"OrderStatus",
            ${OrderStatus.REFUNDED}::"OrderStatus"
          )
        GROUP BY sale."customerId"
      `)
    : [];
  const purchaseStats = new Map(
    purchaseStatsRows.map((order) => [order.customerId, { count: Number(order.orderCount), total: order.netSpend.toString() }]),
  );
  const canManage = canManageCustomers(membership.role);
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (showInactive) params.set("status", "inactive");
    params.set("page", String(target));
    return `/customers?${params.toString()}`;
  };
  const statusHref = (() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (!showInactive) params.set("status", "inactive");
    const suffix = params.toString();
    return suffix ? `/customers?${suffix}` : "/customers";
  })();
  const rangeStart = customerCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, customerCount);

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
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Customers</p>
          <h1>Customer directory</h1>
          <p className="header-note">{showInactive ? "Inactive customer records" : "Customer contacts and recorded purchase summaries"} for {organization.name}.</p>
        </div>
        <div className="header-store">{customerCount.toLocaleString("en-GH")} customers<span>{showInactive ? "Inactive records" : "Active directory"}</span></div>
      </header>

      <div className="section-heading">
        <div><p className="eyebrow">Customer relationships</p><h2>Customers</h2></div>
        <Link className="customer-filter-link" href={statusHref}>
          {showInactive ? "View active customers" : "View inactive customers"}
        </Link>
      </div>

      <div className="catalog-layout">
        <section className="data-panel catalog-table-panel">
          {(notice === "deactivated" || notice === "reactivated") && (
            <p className="form-success customer-notice" role="status">
              {notice === "deactivated" ? "Customer deactivated. Their purchase history is preserved." : "Customer reactivated."}
            </p>
          )}
          <form className="search-form" method="get" role="search">
            <label className="visually-hidden" htmlFor="customer-search">Search customers by name, email, or phone</label>
            {showInactive && <input type="hidden" name="status" value="inactive" />}
            <input id="customer-search" name="q" type="search" defaultValue={query} placeholder="Search name, email, or phone..." maxLength={80} />
            <button className="button-quiet" type="submit">Search</button>
            {query && <Link className="clear-search" href={showInactive ? "/customers?status=inactive" : "/customers"}>Clear</Link>}
          </form>

          <div className="table-scroll">
            <table className="data-table operational-table">
              <thead><tr><th>Customer</th><th>Contact</th><th>Paid orders</th><th>Recorded spend · {organization.currency}</th><th>Loyalty points</th></tr></thead>
              <tbody>
                {customers.map((customer) => {
                  const stats = purchaseStats.get(customer.id);
                  return (
                    <CustomerRow
                      key={customer.id}
                      customer={{ ...customer, loyaltyPoints: Number(customer.loyaltyPoints) }}
                      currency={organization.currency}
                      orderCount={stats?.count ?? 0}
                      totalSpend={stats?.total ?? "0"}
                      canManage={canManage}
                      showInactive={showInactive}
                      orders={customer.orders.map((order) => ({
                        id: order.id,
                        number: order.number,
                        status: order.status,
                        createdAt: new Intl.DateTimeFormat("en-GH", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: organization.timezone,
                        }).format(order.createdAt),
                        total: order.total.toString(),
                        currency: order.currency,
                        storeName: order.store.name,
                        items: order.items.map((item) => ({
                          id: item.id,
                          productName: item.productName,
                          sku: item.sku,
                          quantity: item.quantity,
                          unitPrice: item.unitPrice.toString(),
                          lineTotal: item.lineTotal.toString(),
                        })),
                        payments: order.payments.map((payment) => ({
                          id: payment.id,
                          method: payment.method,
                          status: payment.status,
                          amount: payment.amount.toString(),
                        })),
                      }))}
                    />
                  );
                })}
                {customers.length === 0 && (
                  <tr><td className="table-empty" colSpan={5}>{query ? `No customers match “${query}”.` : showInactive ? "No inactive customers." : "No customers yet. Add a customer to start your directory."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {customerCount > 0 && (
            <nav className="customer-directory-pagination" aria-label="Customer directory pages">
              <span>Showing {rangeStart}–{rangeEnd} of {customerCount.toLocaleString("en-GH")}</span>
              <div>
                {page > 1 ? <Link className="button-quiet" href={pageHref(page - 1)}>Previous</Link> : <span className="button-quiet pagination-disabled">Previous</span>}
                <span>Page {page} of {pageCount}</span>
                {page < pageCount ? <Link className="button-quiet" href={pageHref(page + 1)}>Next</Link> : <span className="button-quiet pagination-disabled">Next</span>}
              </div>
            </nav>
          )}
        </section>

        <aside className="form-panel">
          <p className="eyebrow">Customer records</p>
          <h2>New customer</h2>
          <p className="form-intro">Save contact details to make customer selection available in the sales workflow.</p>
          {canManage && !showInactive
            ? <CustomerForm />
            : !canManage
              ? <p className="permission-note">Your role can view customer records, but cannot manage them.</p>
              : <p className="permission-note">Reactivate a customer before editing their details.</p>}
        </aside>
      </div>
      <footer className="workspace-footer"><span>{organization.name}</span><span>Customer records are shared across your business locations.</span></footer>
    </WorkspaceShell>
  );
}
