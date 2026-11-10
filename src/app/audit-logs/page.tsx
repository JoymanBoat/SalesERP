import Link from "next/link";
import { MembershipRole } from "@prisma/client";

import { WorkspaceShell } from "@/components/workspace-shell";
import { buildAuditLogWhere } from "@/lib/audit-logs";
import { getPageCount, parsePage } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

const pageSize = 25;

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; action?: string }>;
}) {
  const { session, membership, organization, store } = await getWorkspace({ allowedRoles: [MembershipRole.OWNER], operation: "view" });
  const { page: rawPage, q = "", action: rawAction = "" } = await searchParams;
  const query = q.trim().slice(0, 80);
  const [actionGroups, totalCount] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ["action"],
      where: { organizationId: organization.id },
      orderBy: { action: "asc" },
    }),
    prisma.auditLog.count({ where: { organizationId: organization.id } }),
  ]);
  const action = actionGroups.some(({ action: availableAction }) => availableAction === rawAction)
    ? rawAction
    : "";
  const where = buildAuditLogWhere(organization.id, query, action);
  const total = action || query
    ? await prisma.auditLog.count({ where })
    : totalCount;
  const pageCount = getPageCount(total, pageSize);
  const page = Math.min(parsePage(rawPage), pageCount);
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { actor: { select: { name: true, email: true } } },
  });
  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: organization.timezone,
  });
  const pageHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (action) params.set("action", action);
    params.set("page", String(nextPage));
    return `/audit-logs?${params.toString()}`;
  };
  const exportParams = new URLSearchParams();
  if (query) exportParams.set("q", query);
  if (action) exportParams.set("action", action);
  const exportQuery = exportParams.toString();
  const exportHref = `/audit-logs/export${exportQuery ? `?${exportQuery}` : ""}`;

  return (
    <WorkspaceShell
      activeSection="audit-logs"
      membershipId={membership.id}
      organizationId={organization.id}
      organizationName={organization.name}
      storeId={store.id}
      storeName={store.name}
      currency={organization.currency}
      userName={session.user.name ?? session.user.email ?? "User"}
      role={membership.role}
    >
      <header className="workspace-header">
        <div>
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Administration</p>
          <h1>Audit history</h1>
          <p className="header-note">Review recorded changes for {organization.name}. Times use the organization timezone.</p>
        </div>
        <div className="header-store">{total.toLocaleString("en-GH")} events<span>{query || action ? "Matching organization-wide" : "Organization-wide"}</span></div>
        <Link className="button-quiet" href={exportHref}>Export CSV</Link>
      </header>

      <section className="data-panel inventory-table-panel">
        <form className="search-form" action="/audit-logs" method="get" role="search">
          <label className="visually-hidden" htmlFor="audit-search">Search audit history</label>
          <input id="audit-search" name="q" type="search" defaultValue={query} placeholder="Search action, actor, or entity..." maxLength={80} />
          <label className="visually-hidden" htmlFor="audit-action">Filter by action</label>
          <select id="audit-action" name="action" defaultValue={action}>
            <option value="">All actions</option>
            {actionGroups.map(({ action: availableAction }) => (
              <option key={availableAction} value={availableAction}>{availableAction}</option>
            ))}
          </select>
          <button className="button-quiet" type="submit">Filter</button>
          {(query || action) && <Link className="clear-search" href="/audit-logs">Clear</Link>}
        </form>
        <div className="table-scroll">
          <table className="operational-table">
            <thead>
              <tr>
                <th scope="col">Recorded</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Entity</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{dateFormatter.format(log.createdAt)}</td>
                  <td>{log.actor?.name ?? log.actor?.email ?? "Unavailable"}</td>
                  <td><strong>{log.action}</strong></td>
                  <td>
                    {log.entityType}
                    {log.entityId && <small className="table-secondary">{log.entityId}</small>}
                  </td>
                  <td className="audit-log-details">
                    {log.details
                      ? <details><summary>View details</summary><pre>{JSON.stringify(log.details, null, 2)}</pre></details>
                      : "—"}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td className="table-empty" colSpan={5}>No audit events have been recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {total > 0 && (
        <nav className="customer-directory-pagination" aria-label="Audit history pages">
          <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString("en-GH")} events</span>
          <div>
            {page > 1
              ? <Link className="button-quiet" href={pageHref(page - 1)}>Previous</Link>
              : <span className="button-quiet pagination-disabled">Previous</span>}
            <span>Page {page} of {pageCount}</span>
            {page < pageCount
              ? <Link className="button-quiet" href={pageHref(page + 1)}>Next</Link>
              : <span className="button-quiet pagination-disabled">Next</span>}
          </div>
        </nav>
      )}
      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
