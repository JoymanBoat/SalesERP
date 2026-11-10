import Link from "next/link";
import { ArrowRight, Building2, ShieldCheck, Store, Users } from "lucide-react";

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { prisma } from "@/lib/prisma";

import { PlatformShell } from "./platform-shell";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const session = await requirePlatformAdmin();
  const organizations = await prisma.organization.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, createdAt: true, _count: { select: { memberships: true, stores: true } } },
    take: 100,
  });
  await prisma.platformAuditEvent.create({
    data: { actorId: session.user.id, action: "business_directory.viewed" },
  });

  return (
    <PlatformShell active="businesses">
      <header className="platform-header">
        <div><p className="platform-eyebrow">PLATFORM OVERVIEW</p><h1>Businesses</h1><p>Explore the businesses on your platform and review their records.</p></div>
        <span className="platform-header-badge"><ShieldCheck size={16} aria-hidden="true" /> Read-only access</span>
      </header>
      <section className="platform-intro">
        <div><p className="platform-eyebrow">YOUR PLATFORM</p><h2>A clearer view of your businesses.</h2><p>Review business activity in one place. Every visit to business records is recorded for accountability.</p><Link href="/platform/audit">Explore the audit log <ArrowRight size={15} aria-hidden="true" /></Link></div>
        <div className="platform-intro-icon"><Building2 size={38} strokeWidth={1.4} aria-hidden="true" /></div>
      </section>
      <section className="platform-panel" aria-labelledby="business-directory">
        <div className="platform-panel-heading"><div><p className="platform-eyebrow">DIRECTORY</p><h2 id="business-directory">Business directory</h2><p>Showing up to 100 businesses, sorted by name.</p></div><span className="platform-count">{organizations.length} shown</span></div>
        {organizations.length === 0 ? <p className="platform-empty">No businesses to show yet.</p> : (
          <div className="platform-business-list">{organizations.map((organization) => (
            <Link className="platform-business" href={`/platform/businesses/${organization.id}`} key={organization.id}>
              <span className="platform-business-icon"><Building2 size={20} aria-hidden="true" /></span>
              <span className="platform-business-name"><strong>{organization.name}</strong><small>View business records</small></span>
              <span className="platform-business-stats">
                <span className="platform-business-stat"><Store size={15} aria-hidden="true" /> {organization._count.stores} stores</span>
                <span className="platform-business-stat"><Users size={15} aria-hidden="true" /> {organization._count.memberships} members</span>
              </span>
              <ArrowRight className="platform-arrow" size={18} aria-hidden="true" />
            </Link>
          ))}</div>
        )}
      </section>
      <p className="platform-footnote">Paid subscriptions, package features and capacity limits are enforced. Payments are recorded manually; the application does not collect funds.</p>
    </PlatformShell>
  );
}
