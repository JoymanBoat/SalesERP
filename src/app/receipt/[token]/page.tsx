import { OrderStatus } from "@prisma/client";
import { notFound } from "next/navigation";

import { formatGhanaCedis } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { readReceiptToken } from "@/lib/receipt-link";
import { organizationCanUseFeature } from "@/lib/subscription-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sale receipt — Keta Retail", robots: { index: false, follow: false } };

export default async function SharedReceipt({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  const receipt = secret && secret.length >= 32 ? readReceiptToken(token, secret) : null;
  if (!receipt) notFound();

  const order = await prisma.order.findFirst({
    where: { id: receipt.orderId, status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED] } },
    select: {
      organizationId: true, number: true, status: true, createdAt: true, subtotal: true, discountTotal: true, taxTotal: true, total: true,
      organization: { select: { name: true, timezone: true } },
      store: { select: { name: true } },
      items: { orderBy: { id: "asc" }, select: { id: true, productName: true, quantity: true, unitPrice: true, lineTotal: true } },
      refunds: { select: { amount: true } },
    },
  });
  if (!order) notFound();
  if (!(await organizationCanUseFeature(prisma, order.organizationId, "pos", "view"))) notFound();
  const date = new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: order.organization.timezone }).format(order.createdAt);
  const money = (value: { toString(): string }) => formatGhanaCedis(value.toString());

  return (
    <main className="shared-receipt-page">
      <article className="data-panel pos-receipt shared-receipt">
        <div className="receipt-business"><h1>{order.organization.name}</h1><p>{order.store.name} · {date}</p><strong>Receipt · Sale #{order.number}</strong><span>{order.status.replaceAll("_", " ")}</span></div>
        <div className="shared-receipt-items">
          {order.items.map((item) => <div key={item.id}><span>{item.productName}<small>{item.quantity} × {money(item.unitPrice)}</small></span><strong>{money(item.lineTotal)}</strong></div>)}
        </div>
        <dl className="receipt-totals">
          <div><dt>Subtotal</dt><dd>{money(order.subtotal)}</dd></div>
          <div><dt>Discount</dt><dd>−{money(order.discountTotal)}</dd></div>
          <div><dt>Tax</dt><dd>{money(order.taxTotal)}</dd></div>
          <div className="receipt-grand-total"><dt>Total</dt><dd>{money(order.total)}</dd></div>
          {order.refunds.map((refund, index) => <div key={index}><dt>Refund</dt><dd>{money(refund.amount)}</dd></div>)}
        </dl>
        <footer className="receipt-footer">Thank you for shopping with {order.organization.name}.</footer>
      </article>
    </main>
  );
}
