import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { z } from "zod";

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { prisma } from "@/lib/prisma";

import { PlatformShell } from "../../platform-shell";

export const dynamic = "force-dynamic";

export default async function PlatformBusinessPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const session = await requirePlatformAdmin();
  const parsed = z.string().cuid().safeParse((await params).organizationId);
  if (!parsed.success) notFound();

  const organization = await prisma.organization.findUnique({
    where: { id: parsed.data },
    select: {
      id: true, name: true, currency: true, timezone: true,
      stores: { orderBy: { name: "asc" }, select: { id: true, name: true, active: true }, take: 100 },
      products: { orderBy: { name: "asc" }, select: { id: true, name: true, archivedAt: true }, take: 100 },
      orders: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true, total: true, currency: true, createdAt: true }, take: 100 },
    },
  });
  if (!organization) notFound();
  await prisma.platformAuditEvent.create({
    data: { actorId: session.user.id, organizationId: organization.id, action: "business_records.viewed" },
  });

  return (
    <PlatformShell active="businesses">
      <Link href="/platform" className="platform-back"><ArrowLeft size={16} aria-hidden="true" /> Business directory</Link>
      <header className="platform-header">
        <div><p className="platform-eyebrow">BUSINESS RECORDS</p><h1>{organization.name}</h1><p>Read-only overview. Lists are limited to 100 records.</p></div>
        <span className="platform-header-badge"><ShieldCheck size={16} aria-hidden="true" /> Access audited</span>
      </header>
      <p className="platform-payment-link"><Link href={`/platform/businesses/${organization.id}/payments`}>View and record subscription payments <span aria-hidden="true">→</span></Link></p>
      <div className="platform-detail-grid">
        <section className="platform-panel" aria-labelledby="business-stores">
          <div className="platform-panel-heading"><div><p className="platform-eyebrow">LOCATIONS</p><h2 id="business-stores">Stores</h2></div><span className="platform-count">{organization.stores.length} shown</span></div>
          {organization.stores.length === 0 ? <p className="platform-empty">No stores to show.</p> : <ul className="platform-record-list">{organization.stores.map((store) => <li key={store.id}><strong>{store.name}</strong><span className={`platform-status ${store.active ? "" : "is-muted"}`}>{store.active ? "Active" : "Inactive"}</span></li>)}</ul>}
        </section>
        <section className="platform-panel" aria-labelledby="business-products">
          <div className="platform-panel-heading"><div><p className="platform-eyebrow">CATALOG</p><h2 id="business-products">Products</h2></div><span className="platform-count">{organization.products.length} shown</span></div>
          {organization.products.length === 0 ? <p className="platform-empty">No products to show.</p> : <ul className="platform-record-list">{organization.products.map((product) => <li key={product.id}><strong>{product.name}</strong><span className={`platform-status ${product.archivedAt ? "is-muted" : ""}`}>{product.archivedAt ? "Archived" : "Active"}</span></li>)}</ul>}
        </section>
      </div>
      <section className="platform-panel" aria-labelledby="business-sales">
        <div className="platform-panel-heading"><div><p className="platform-eyebrow">TRANSACTIONS</p><h2 id="business-sales">Recent sales</h2><p>Dates shown in the business timezone.</p></div><span className="platform-count">{organization.orders.length} shown</span></div>
        {organization.orders.length === 0 ? <p className="platform-empty">No sales to show.</p> : <div className="platform-table-scroll"><table className="platform-table"><thead><tr><th scope="col">Sale</th><th scope="col">Status</th><th scope="col">Total</th><th scope="col">Created</th></tr></thead><tbody>
          {organization.orders.map((order) => <tr key={order.id}><td>#{order.number}</td><td>{order.status.replaceAll("_", " ")}</td><td>{order.currency} {order.total.toFixed(2)}</td><td>{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeZone: organization.timezone }).format(order.createdAt)}</td></tr>)}
        </tbody></table></div>}
      </section>
    </PlatformShell>
  );
}
