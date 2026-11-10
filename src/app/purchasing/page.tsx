import { Prisma, PurchaseOrderStatus } from "@prisma/client";
import Link from "next/link";

import { PurchaseOrderCard } from "@/components/purchase-order-card";
import { PurchaseOrderForm } from "@/components/purchase-order-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canManageSupplierInvoices, canManageSuppliers } from "@/lib/permissions";
import { parseRestockQuantity } from "@/lib/inventory";
import { getPageCount, parsePage } from "@/lib/pagination";
import { businessDateInTimeZone } from "@/lib/pos";
import { purchaseOrderIsOverdue, supplierFollowUpIsDue } from "@/lib/purchasing";
import { prisma } from "@/lib/prisma";
import { getSupplierInvoiceReminderSummary } from "@/lib/supplier-invoice-reminders";
import { getWorkspace } from "@/lib/workspace";

const pageSize = 20;

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; q?: string; status?: string; page?: string; restockVariant?: string; restockQuantity?: string }>;
}) {
  const { session, membership, organization, store } = await getWorkspace({ feature: "purchasing", operation: "view" });
  const { notice, q = "", status, page: rawPage, restockVariant, restockQuantity } = await searchParams;
  const canManage = canManageSuppliers(membership.role);
  const requestedRestockVariantId = canManage ? restockVariant?.trim().slice(0, 30) : undefined;
  const requestedRestockQuantity = parseRestockQuantity(restockQuantity);
  const canManageInvoices = canManageSupplierInvoices(membership.role);
  const query = q.trim().slice(0, 80);
  const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
  const businessDateStart = new Date(`${businessDate}T00:00:00.000Z`);
  const nextBusinessDateStart = new Date(businessDateStart);
  nextBusinessDateStart.setUTCDate(nextBusinessDateStart.getUTCDate() + 1);
  const dueSoonEnd = new Date(businessDateStart);
  dueSoonEnd.setUTCDate(dueSoonEnd.getUTCDate() + 7);
  const dueSoonEndDate = dueSoonEnd.toISOString().slice(0, 10);
  const invoiceReminderSummary = canManageInvoices
    ? await getSupplierInvoiceReminderSummary(organization.id, store.id, businessDate)
    : null;
  const statusFilter = Object.values(PurchaseOrderStatus).find((value) => value === status);
  const overdueFilter = status === "OVERDUE";
  const followUpDueFilter = status === "FOLLOWUP_DUE";
  const invoiceOverdueFilter = canManageInvoices && status === "INVOICE_OVERDUE";
  const invoiceDueSoonFilter = canManageInvoices && status === "INVOICE_DUE_SOON";
  const invoiceNoDueDateFilter = canManageInvoices && status === "INVOICE_NO_DUE_DATE";
  const overdueInvoiceOrders = invoiceOverdueFilter ? invoiceReminderSummary?.overduePurchaseOrderIds ?? [] : [];
  const dueSoonInvoiceOrders = invoiceDueSoonFilter ? invoiceReminderSummary?.dueSoonPurchaseOrderIds ?? [] : [];
  const noDueDateInvoiceOrders = invoiceNoDueDateFilter ? invoiceReminderSummary?.noDueDatePurchaseOrderIds ?? [] : [];
  const orderNumber = /^\d+$/.test(query) ? Number(query) : undefined;
  const where: Prisma.PurchaseOrderWhereInput = {
    organizationId: organization.id,
    storeId: store.id,
    ...(overdueFilter
      ? {
          status: { in: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
          expectedAt: { lt: businessDateStart },
        }
      : followUpDueFilter
        ? {
            status: { in: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
            nextFollowUpAt: { lt: nextBusinessDateStart },
          }
        : invoiceOverdueFilter
          ? { id: { in: [...overdueInvoiceOrders] } }
          : invoiceDueSoonFilter
            ? { id: { in: [...dueSoonInvoiceOrders] } }
            : invoiceNoDueDateFilter
              ? { id: { in: [...noDueDateInvoiceOrders] } }
              : statusFilter ? { status: statusFilter } : {}),
    ...(query
      ? {
          OR: [
            { supplier: { businessName: { contains: query, mode: "insensitive" } } },
            { notes: { contains: query, mode: "insensitive" } },
            { items: { some: { productName: { contains: query, mode: "insensitive" } } } },
            { items: { some: { sku: { contains: query, mode: "insensitive" } } } },
            { invoices: { some: { invoiceNumber: { contains: query, mode: "insensitive" } } } },
            ...(orderNumber && Number.isSafeInteger(orderNumber) ? [{ number: orderNumber }] : []),
            ...Object.values(PurchaseOrderStatus)
              .filter((value) => value.replaceAll("_", " ").toLowerCase() === query.replaceAll("_", " ").toLowerCase())
              .map((value) => ({ status: value })),
          ],
        }
      : {}),
  };
  const [suppliers, listedVariants, requestedRestockVariant, orderCount, openCount, overdueCount, followUpDueCount] = await Promise.all([
    prisma.supplier.findMany({
      where: { organizationId: organization.id, archivedAt: null },
      orderBy: { businessName: "asc" },
      take: 200,
      select: { id: true, businessName: true },
    }),
    prisma.productVariant.findMany({
      where: { organizationId: organization.id, product: { archivedAt: null } },
      orderBy: { product: { name: "asc" } },
      take: 200,
      include: { product: { select: { name: true } } },
    }),
    requestedRestockVariantId
      ? prisma.productVariant.findFirst({
          where: {
            id: requestedRestockVariantId,
            organizationId: organization.id,
            product: { archivedAt: null },
          },
          include: { product: { select: { name: true } } },
        })
      : Promise.resolve(null),
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.count({
      where: {
        organizationId: organization.id,
        storeId: store.id,
        status: { in: ["ORDERED", "PARTIALLY_RECEIVED"] },
      },
    }),
    prisma.purchaseOrder.count({
      where: {
        organizationId: organization.id,
        storeId: store.id,
        status: { in: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        expectedAt: { lt: businessDateStart },
      },
    }),
    prisma.purchaseOrder.count({
      where: {
        organizationId: organization.id,
        storeId: store.id,
        status: { in: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        nextFollowUpAt: { lt: nextBusinessDateStart },
      },
    }),
  ]);
  const variants = requestedRestockVariant && !listedVariants.some(({ id }) => id === requestedRestockVariant.id)
    ? [...listedVariants, requestedRestockVariant]
    : listedVariants;
  const initialLine = requestedRestockVariant && requestedRestockQuantity
    ? { variantId: requestedRestockVariant.id, quantity: requestedRestockQuantity }
    : undefined;
  const pageCount = getPageCount(orderCount, pageSize);
  const page = Math.min(parsePage(rawPage), pageCount);
  const rangeStart = orderCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, orderCount);
  const orders = await prisma.purchaseOrder.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      supplier: { select: { businessName: true } },
      store: { select: { name: true } },
      items: {
        orderBy: { id: "asc" },
        include: { returns: { select: { quantity: true, unitCost: true } } },
      },
      returns: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          createdBy: { select: { name: true, email: true } },
          items: {
            include: {
              purchaseOrderItem: { select: { productName: true, sku: true } },
            },
          },
        },
      },
      invoices: {
        orderBy: [{ invoiceDate: "desc" }, { id: "desc" }],
        include: {
          createdBy: { select: { name: true, email: true } },
          payments: {
            orderBy: [{ paidAt: "desc" }, { id: "desc" }],
            include: { createdBy: { select: { name: true, email: true } } },
          },
          creditNotes: {
            orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
            include: { createdBy: { select: { name: true, email: true } } },
          },
        },
      },
      followUps: {
        orderBy: [{ contactedAt: "desc" }, { id: "desc" }],
        take: 10,
        include: { createdBy: { select: { name: true, email: true } } },
      },
    },
  });
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (statusFilter) params.set("status", statusFilter);
    else if (overdueFilter) params.set("status", "OVERDUE");
    else if (followUpDueFilter) params.set("status", "FOLLOWUP_DUE");
    else if (invoiceOverdueFilter) params.set("status", "INVOICE_OVERDUE");
    else if (invoiceDueSoonFilter) params.set("status", "INVOICE_DUE_SOON");
    else if (invoiceNoDueDateFilter) params.set("status", "INVOICE_NO_DUE_DATE");
    if (target > 1) params.set("page", String(target));
    if (notice) params.set("notice", notice);
    const queryString = params.toString();
    return queryString ? `/purchasing?${queryString}` : "/purchasing";
  };
  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeZone: organization.timezone,
  });
  const invoiceCalendarDateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeZone: "UTC",
  });

  return (
    <WorkspaceShell
      activeSection="purchasing"
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
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Purchasing</p>
          <h1>Purchase orders</h1>
          <p className="header-note">Order stock, receive it into {store.name}, and reconcile supplier invoices, credits, and payments.</p>
        </div>
            <div className="header-store">
              {openCount.toLocaleString("en-GH")} open
              <span>{overdueCount.toLocaleString("en-GH")} overdue · {followUpDueCount.toLocaleString("en-GH")} follow-ups due</span>
              {invoiceReminderSummary && (
                <span>
                  {invoiceReminderSummary.overdueCount.toLocaleString("en-GH")} invoices past due · {invoiceReminderSummary.dueSoonCount.toLocaleString("en-GH")} due within 7 days · {invoiceReminderSummary.noDueDateCount.toLocaleString("en-GH")} without due date
                </span>
              )}
            </div>
      </header>

      <div className="section-heading">
        <div><p className="eyebrow">Supplier purchasing</p><h2>Order history</h2></div>
        <span className="data-source-note">Showing {rangeStart}–{rangeEnd} of {orderCount} purchase orders</span>
      </div>

      {notice === "created" && <p className="form-success purchasing-notice" role="status">Purchase order created.</p>}

      <div className="purchasing-layout">
        <section className="purchase-order-list" aria-label="Purchase order history">
          <form className="search-form purchase-order-filters" action="/purchasing" method="get">
            <label className="visually-hidden" htmlFor="purchase-order-search">Search purchase orders</label>
            <input
              id="purchase-order-search"
              name="q"
              placeholder="Search supplier, order number, item, SKU, or notes"
              defaultValue={query}
            />
            <label className="visually-hidden" htmlFor="purchase-order-status">Filter by status</label>
            <select
              id="purchase-order-status"
              name="status"
              defaultValue={overdueFilter ? "OVERDUE" : followUpDueFilter ? "FOLLOWUP_DUE" : invoiceOverdueFilter ? "INVOICE_OVERDUE" : invoiceDueSoonFilter ? "INVOICE_DUE_SOON" : invoiceNoDueDateFilter ? "INVOICE_NO_DUE_DATE" : statusFilter ?? ""}
            >
              <option value="">All statuses</option>
              <option value="OVERDUE">Overdue</option>
              <option value="FOLLOWUP_DUE">Follow-up due</option>
              {canManageInvoices && (
                <>
                  <option value="INVOICE_OVERDUE">Invoices past due</option>
                  <option value="INVOICE_DUE_SOON">Invoices due within 7 days</option>
                  <option value="INVOICE_NO_DUE_DATE">Invoices without due date</option>
                </>
              )}
              {Object.values(PurchaseOrderStatus).map((value) => (
                <option key={value} value={value}>{value.replaceAll("_", " ")}</option>
              ))}
            </select>
            <button className="button-quiet" type="submit">Search</button>
          </form>
          {orders.map((order) => (
            <PurchaseOrderCard
              key={order.id}
              businessDate={businessDate}
              dueSoonEndDate={dueSoonEndDate}
              order={{
                id: order.id,
                number: order.number,
                status: order.status,
                overdue: purchaseOrderIsOverdue(order.status, order.expectedAt, businessDate),
                followUpDue: supplierFollowUpIsDue(order.status, order.nextFollowUpAt, businessDate),
                nextFollowUpAt: order.nextFollowUpAt
                  ? dateFormatter.format(order.nextFollowUpAt)
                  : null,
                subtotal: order.subtotal.toString(),
                supplierName: order.supplier.businessName,
                storeName: order.store.name,
                createdAt: dateFormatter.format(order.createdAt),
                expectedAt: order.expectedAt ? dateFormatter.format(order.expectedAt) : null,
                notes: order.notes,
                items: order.items.map((item) => ({
                  id: item.id,
                  productName: item.productName,
                  sku: item.sku,
                  orderedQuantity: item.orderedQuantity,
                  receivedQuantity: item.receivedQuantity,
                  returnedQuantity: item.returns.reduce((total, returned) => total + returned.quantity, 0),
                  unitCost: item.unitCost.toString(),
                })),
                followUps: order.followUps.map((followUp) => ({
                  id: followUp.id,
                  method: followUp.method,
                  summary: followUp.summary,
                  contactedAt: new Intl.DateTimeFormat("en-GH", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: organization.timezone,
                  }).format(followUp.contactedAt),
                  followUpAt: followUp.followUpAt
                    ? dateFormatter.format(followUp.followUpAt)
                    : null,
                  createdBy: followUp.createdBy?.name ?? followUp.createdBy?.email ?? "Former user",
                })),
                returns: order.returns.map((supplierReturn) => ({
                  id: supplierReturn.id,
                  reason: supplierReturn.reason,
                  createdAt: new Intl.DateTimeFormat("en-GH", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: organization.timezone,
                  }).format(supplierReturn.createdAt),
                  createdBy: supplierReturn.createdBy?.name ?? supplierReturn.createdBy?.email ?? "Former user",
                  items: supplierReturn.items.map((item) => ({
                    productName: item.purchaseOrderItem.productName,
                    sku: item.purchaseOrderItem.sku,
                    quantity: item.quantity,
                    unitCost: item.unitCost.toString(),
                  })),
                  recordedValue: supplierReturn.items.reduce(
                    (total, item) => total.plus(item.unitCost.mul(item.quantity)),
                    new Prisma.Decimal(0),
                  ).toString(),
                })),
                receivedNetValue: order.items.reduce((total, item) => {
                  const receivedValue = item.unitCost.mul(item.receivedQuantity);
                  const returnedValue = item.returns.reduce(
                    (returnTotal, supplierReturn) => returnTotal.plus(supplierReturn.unitCost.mul(supplierReturn.quantity)),
                    new Prisma.Decimal(0),
                  );
                  return total.plus(receivedValue).minus(returnedValue);
                }, new Prisma.Decimal(0)).toString(),
                invoices: order.invoices.map((invoice) => ({
                  id: invoice.id,
                  invoiceNumber: invoice.invoiceNumber,
                  amount: invoice.amount.toString(),
                  invoiceDate: invoiceCalendarDateFormatter.format(invoice.invoiceDate),
                  invoiceDateKey: invoice.invoiceDate.toISOString().slice(0, 10),
                  dueDate: invoice.dueDate
                    ? invoiceCalendarDateFormatter.format(invoice.dueDate)
                    : null,
                  dueDateKey: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
                  note: invoice.note,
                  createdBy: invoice.createdBy?.name ?? invoice.createdBy?.email ?? null,
                  recordedAt: new Intl.DateTimeFormat("en-GH", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: organization.timezone,
                  }).format(invoice.createdAt),
                  payments: invoice.payments.map((payment) => ({
                    id: payment.id,
                    amount: payment.amount.toString(),
                    method: payment.method,
                    reference: payment.reference,
                    note: payment.note,
                    createdBy: payment.createdBy?.name ?? payment.createdBy?.email ?? null,
                    paidAt: invoiceCalendarDateFormatter.format(payment.paidAt),
                    recordedAt: payment.paidAt.getTime(),
                  })),
                  creditNotes: invoice.creditNotes.map((credit) => ({
                    id: credit.id,
                    creditNoteNumber: credit.creditNoteNumber,
                    amount: credit.amount.toString(),
                    reason: credit.reason,
                    createdBy: credit.createdBy?.name ?? credit.createdBy?.email ?? null,
                    issuedAt: invoiceCalendarDateFormatter.format(credit.issuedAt),
                    recordedAt: credit.issuedAt.getTime(),
                  })),
                })),
              }}
              organizationName={organization.name}
              currency={organization.currency}
              canReceive={canManage}
              canManageInvoices={canManageInvoices}
            />
          ))}
          {orders.length === 0 && (
            <section className="data-panel purchase-empty">
              <h2>{query || statusFilter || overdueFilter || followUpDueFilter || invoiceOverdueFilter || invoiceDueSoonFilter || invoiceNoDueDateFilter ? "No matching purchase orders" : "No purchase orders yet"}</h2>
              <p>
                {query || statusFilter || overdueFilter || followUpDueFilter || invoiceOverdueFilter || invoiceDueSoonFilter || invoiceNoDueDateFilter
                  ? "Try a different search or status filter."
                  : "Once you place a supplier order, you can track its status and receive quantities into stock here."}
              </p>
            </section>
          )}
          {pageCount > 1 && (
            <nav className="customer-directory-pagination" aria-label="Purchase order pages">
              <span>Page {page} of {pageCount}</span>
              <div>
                <span>{rangeStart}–{rangeEnd} of {orderCount}</span>
                {page > 1 && <Link className="button-quiet" href={pageHref(page - 1)}>Previous</Link>}
                {page < pageCount && <Link className="button-quiet" href={pageHref(page + 1)}>Next</Link>}
              </div>
            </nav>
          )}
        </section>

        <aside className="form-panel">
          <p className="eyebrow">Stock replenishment</p>
          <h2>New purchase order</h2>
          <p className="form-intro">Create an order for a supplier. Receiving updates inventory and creates a stock ledger entry.</p>
          {canManage
            ? <PurchaseOrderForm
                key={initialLine ? `${initialLine.variantId}:${initialLine.quantity}` : "new"}
                suppliers={suppliers}
                initialLine={initialLine}
                variants={variants.map((variant) => ({
                  id: variant.id,
                  name: variant.name === "Default" ? variant.product.name : `${variant.product.name} · ${variant.name}`,
                  sku: variant.sku,
                  unitCost: variant.costPrice?.toString() ?? "0",
                }))}
              />
            : <p className="permission-note">Your role can view purchase orders but cannot create or receive them.</p>}
        </aside>
      </div>
      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
