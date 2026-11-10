import Link from "next/link";
import { notFound } from "next/navigation";

import { ReceiptPrintButton } from "@/components/receipt-print-button";
import { ReceiptShare } from "@/components/receipt-share";
import { WorkspaceShell } from "@/components/workspace-shell";
import { formatGhanaCedis } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { TAX_TREATMENT_LABELS } from "@/lib/tax";
import { getWorkspace } from "@/lib/workspace";

export default async function PosReceiptPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { session, membership, organization, store } = await getWorkspace({ feature: "pos", operation: "view" });
  const { orderId } = await params;
  const order = await prisma.order.findFirst({
    where: { id: orderId, organizationId: organization.id, storeId: store.id },
    include: {
      customer: { select: { firstName: true, lastName: true, email: true, phone: true } },
      items: { orderBy: { id: "asc" } },
      payments: { orderBy: { createdAt: "asc" } },
      refunds: {
        orderBy: { createdAt: "asc" },
        include: {
          saleReturn: {
            include: {
              items: {
                include: {
                  orderItem: { select: { productName: true, sku: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) notFound();

  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: organization.timezone,
  });
  const money = (value: string) => formatGhanaCedis(value);
  const cashPayment = order.payments.find((payment) => payment.method === "CASH");
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
      <header className="workspace-header receipt-page-heading">
        <div>
          <p className="breadcrumbs"><Link href="/pos/transactions">Transaction history</Link> / Receipt</p>
          <h1>Sale #{order.number}</h1>
          <p className="header-note">{store.name} · {dateFormatter.format(order.createdAt)}</p>
        </div>
        <div className="receipt-page-actions">
          <Link className="button-quiet" href="/pos/transactions">Back to transactions</Link>
          <ReceiptPrintButton />
        </div>
      </header>

      <article className="data-panel pos-receipt">
        <div className="receipt-business">
          <h2>{organization.name}</h2>
          <p>{store.name}</p>
          <span>{dateFormatter.format(order.createdAt)}</span>
          <strong>Receipt · Sale #{order.number}</strong>
        </div>
        <div className="receipt-parties">
          <div><span>Customer</span><strong>{order.customer ? `${order.customer.firstName} ${order.customer.lastName ?? ""}`.trim() : "Walk-in customer"}</strong>{order.customer?.phone && <small>{order.customer.phone}</small>}{order.customer?.email && <small>{order.customer.email}</small>}</div>
          <div><span>Status</span><strong>{order.status.replaceAll("_", " ")}</strong><small>Currency: {order.currency}</small></div>
        </div>
        <div className="table-scroll">
          <table className="data-table receipt-lines">
            <thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Discount</th><th>Tax</th><th>Total</th></tr></thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.productName}<small>{item.sku}</small>{item.taxTreatment !== "STANDARD" && <small>Tax treatment: {TAX_TREATMENT_LABELS[item.taxTreatment]}</small>}</td>
                  <td>{item.quantity}</td>
                  <td>{money(item.unitPrice.toString())}</td>
                  <td>−{money(item.discountAmount.toString())}</td>
                  <td>{money(item.taxAmount.toString())}</td>
                  <td>{money(item.lineTotal.toString())}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="receipt-totals">
          <div><dt>Subtotal</dt><dd>{money(order.subtotal.toString())}</dd></div>
          <div><dt>Discount{order.promotionCode ? ` · ${order.promotionCode}` : ""}</dt><dd>−{money(order.discountTotal.toString())}</dd></div>
          {order.loyaltyPointsRedeemed > 0n && <div><dt>Loyalty points redeemed</dt><dd>{order.loyaltyPointsRedeemed.toLocaleString("en-GH")}</dd></div>}
          {order.taxComponentsRecorded ? (
            <>
              <div><dt>VAT ({order.vatRate.toString()}%)</dt><dd>{money(order.vatTotal.toString())}</dd></div>
              <div><dt>NHIL ({order.nhilRate.toString()}%)</dt><dd>{money(order.nhilTotal.toString())}</dd></div>
              <div><dt>GETFund ({order.getfundRate.toString()}%)</dt><dd>{money(order.getfundTotal.toString())}</dd></div>
              <div><dt>Total tax</dt><dd>{money(order.taxTotal.toString())}</dd></div>
            </>
          ) : (
            <div><dt>Tax ({order.taxRate.toString()}%, combined)</dt><dd>{money(order.taxTotal.toString())}</dd></div>
          )}
          <div className="receipt-grand-total"><dt>Total</dt><dd>{money(order.total.toString())}</dd></div>
          {order.loyaltyPointsEarned > 0n && <div><dt>Loyalty points earned</dt><dd>{order.loyaltyPointsEarned.toLocaleString("en-GH")}</dd></div>}
        </dl>
        {order.payments.length > 0 && (
          <div className="receipt-payment">
            <h3>Payments</h3>
            {order.payments.map((payment) => (
              <div key={payment.id}><span>{payment.method.replaceAll("_", " ")}{payment.method === "GIFT_CARD" ? " tender" : ""}</span><strong>{money(payment.amount.toString())}</strong></div>
            ))}
            {cashPayment?.cashReceived && <div><span>Cash received</span><strong>{money(cashPayment.cashReceived.toString())}</strong></div>}
            {cashPayment?.changeGiven && <div><span>Change</span><strong>{money(cashPayment.changeGiven.toString())}</strong></div>}
          </div>
        )}
        {order.refunds.length > 0 && (
          <section className="receipt-refunds">
            <h3>Refunds and returns</h3>
            {order.refunds.map((refund) => (
              <article key={refund.id}>
                <div><strong>{money(refund.amount.toString())} refunded</strong><span>{dateFormatter.format(refund.createdAt)}</span></div>
                {refund.cashRefundAmount.lessThan(refund.amount) && (
                  <small>{money(refund.cashRefundAmount.toString())} cash · {money(refund.amount.minus(refund.cashRefundAmount).toString())} restored to gift card</small>
                )}
                <p>{refund.reason}</p>
                {refund.saleReturn?.items.map((item) => (
                  <small key={item.id}>{item.orderItem.productName} · {item.orderItem.sku} × {item.quantity} · {item.restocked ? "restocked" : "not restocked"}</small>
                ))}
              </article>
            ))}
          </section>
        )}
        {order.notes && <p className="receipt-note"><strong>Sale note:</strong> {order.notes}</p>}
        <footer className="receipt-footer">Thank you for shopping with {organization.name}.</footer>
      </article>
      {order.status !== "DRAFT" && order.status !== "CANCELLED" && <ReceiptShare orderId={order.id} customerPhone={order.customer?.phone ?? null} />}
      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
