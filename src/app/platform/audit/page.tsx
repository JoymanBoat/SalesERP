import { ShieldCheck } from "lucide-react";

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { prisma } from "@/lib/prisma";

import { PlatformShell } from "../platform-shell";

export const dynamic = "force-dynamic";

export default async function PlatformAuditPage() {
  const session = await requirePlatformAdmin();
  await prisma.platformAuditEvent.create({
    data: { actorId: session.user.id, action: "platform_audit.viewed" },
  });
  const events = await prisma.platformAuditEvent.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, action: true, organizationId: true, details: true, createdAt: true, actor: { select: { user: { select: { email: true } } } } },
    take: 100,
  });

  return (
    <PlatformShell active="audit">
      <header className="platform-header">
        <div><p className="platform-eyebrow">ACCOUNTABILITY</p><h1>Audit log</h1><p>A record of platform administrator activity and business access.</p></div>
        <span className="platform-header-badge"><ShieldCheck size={16} aria-hidden="true" /> Activity recorded</span>
      </header>
      <section className="platform-panel" aria-labelledby="audit-events">
        <div className="platform-panel-heading"><div><p className="platform-eyebrow">ACTIVITY</p><h2 id="audit-events">Recent events</h2><p>Showing the most recent 100 platform access events. Times are in UTC.</p></div><span className="platform-count">{events.length} shown</span></div>
        {events.length === 0 ? <p className="platform-empty">No activity to show yet.</p> : <div className="platform-table-scroll"><table className="platform-table">
          <thead><tr><th scope="col">Time (UTC)</th><th scope="col">Administrator</th><th scope="col">Action</th><th scope="col">Business ID</th><th scope="col">Details</th></tr></thead>
          <tbody>{events.map((event) => <tr key={event.id}><td>{event.createdAt.toISOString()}</td><td>{event.actor.user.email}</td><td>{event.action}</td><td>{event.organizationId ?? "—"}</td><td>{event.details ? <details className="platform-audit-details"><summary>View details</summary><pre>{JSON.stringify(event.details, null, 2)}</pre></details> : "—"}</td></tr>)}</tbody>
        </table></div>}
      </section>
    </PlatformShell>
  );
}
