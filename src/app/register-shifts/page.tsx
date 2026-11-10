import Link from "next/link";

import { CloseRegisterShiftForm, OpenRegisterShiftForm } from "@/components/register-shift-forms";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canOperateRegister } from "@/lib/permissions";
import { getPageCount, parsePage } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

const pageSize = 20;

export default async function RegisterShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { session, membership, organization, store, register } = await getWorkspace({ feature: "pos", operation: "view" });
  const { page: rawPage } = await searchParams;
  const canOperate = canOperateRegister(membership.role);
  const shiftWhere = {
    organizationId: organization.id,
    storeId: store.id,
    registerId: register?.id ?? "__no_register__",
  };
  const [openShift, recentShifts] = await Promise.all([
    prisma.registerShift.findFirst({
      where: { ...shiftWhere, closedAt: null },
      include: { openedBy: { select: { name: true, email: true } } },
    }),
    prisma.registerShift.count({ where: shiftWhere }),
  ]);
  const pageCount = getPageCount(recentShifts, pageSize);
  const page = Math.min(parsePage(rawPage), pageCount);
  const shifts = await prisma.registerShift.findMany({
    where: shiftWhere,
    orderBy: [{ openedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      openedBy: { select: { name: true, email: true } },
      closedBy: { select: { name: true, email: true } },
    },
  });
  const [openSales, openRefunds] = openShift
    ? await Promise.all([
        prisma.payment.aggregate({
          where: {
            method: "CASH",
            status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] },
            order: { organizationId: organization.id, storeId: store.id, registerShiftId: openShift.id },
          },
          _sum: { amount: true },
        }),
        prisma.refund.aggregate({
          where: { organizationId: organization.id, storeId: store.id, registerShiftId: openShift.id },
          _sum: { amount: true },
        }),
      ])
    : [null, null];
  const liveSales = openSales?._sum.amount ?? null;
  const liveRefunds = openRefunds?._sum.amount ?? null;
  const liveExpected = openShift
    ? openShift.openingCash.plus(liveSales ?? 0).minus(liveRefunds ?? 0)
    : null;
  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: organization.timezone,
  });
  const money = (value: string | null) => value === null
    ? "—"
    : `${organization.currency} ${Number(value).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <WorkspaceShell
      activeSection="register-shifts"
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
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Point of sale</p>
          <h1>Register shifts</h1>
          <p className="header-note">Open and close {register ? `${register.name} at ${store.name}` : `a POS register at ${store.name}`} with a recorded float and counted cash.</p>
        </div>
        <div className="header-store">{openShift ? "Shift open" : "No open shift"}<span>{register?.code ?? "No register assigned"}</span></div>
      </header>

      <div className="register-shift-layout">
        <section className="data-panel register-current-panel">
          <div className="panel-title-row">
            <div><h2>{openShift ? "Current shift" : "Start a shift"}</h2><p>{openShift ? "Only one shift can be open at this POS register." : "Record the cash float before starting register operations."}</p></div>
            <span className={`order-status ${openShift ? "order-status-paid" : "order-status-cancelled"}`}>{openShift ? "OPEN" : "CLOSED"}</span>
          </div>
          <div className="register-shift-content">
            {openShift ? (
              <>
                <dl className="register-shift-facts">
                  <div><dt>Opening float</dt><dd>{money(openShift.openingCash.toString())}</dd></div>
                  <div><dt>Opened</dt><dd>{dateFormatter.format(openShift.openedAt)}</dd></div>
                  <div><dt>Opened by</dt><dd>{openShift.openedBy.name ?? openShift.openedBy.email}</dd></div>
                  <div><dt>Cash sales</dt><dd>{money(liveSales?.toString() ?? "0")}</dd></div>
                  <div><dt>Cash refunds</dt><dd>{money(liveRefunds?.toString() ?? "0")}</dd></div>
                  <div><dt>Expected cash</dt><dd>{money(liveExpected?.toString() ?? null)}</dd></div>
                  {openShift.note && <div><dt>Note</dt><dd>{openShift.note}</dd></div>}
                </dl>
                {canOperate
                  ? <CloseRegisterShiftForm shiftId={openShift.id} openingCash={openShift.openingCash.toString()} />
                  : <p className="permission-note">Your role can view register shifts but cannot close them.</p>}
              </>
            ) : !register
              ? <p className="permission-note">You do not have POS register access at this store. Ask an owner to assign you to a register.</p>
              : canOperate
              ? <OpenRegisterShiftForm />
              : <p className="permission-note">Your role can view register shifts but cannot open one.</p>}
            <p className="register-shift-disclaimer">Expected cash is opening float plus completed cash sales, less cash refunds recorded during the shift. Other payouts are not currently tracked.</p>
          </div>
        </section>

        <section className="data-panel register-history-panel" aria-labelledby="register-history-heading">
          <div className="panel-title-row">
            <div><h2 id="register-history-heading">Shift history</h2><p>Open and closed shifts for this POS register.</p></div>
            <span className="table-count">{recentShifts.toLocaleString("en-GH")} shifts</span>
          </div>
          <div className="table-scroll">
            <table className="data-table operational-table">
              <thead><tr><th>Opened</th><th>Operator</th><th>Float</th><th>Cash sales</th><th>Refunds</th><th>Expected</th><th>Counted close</th><th>Variance</th><th>Status</th></tr></thead>
              <tbody>
                {shifts.map((shift) => (
                  <tr key={shift.id}>
                    <td>{dateFormatter.format(shift.openedAt)}</td>
                    <td>{shift.openedBy.name ?? shift.openedBy.email}</td>
                    <td>{money(shift.openingCash.toString())}</td>
                    <td>{money(shift.cashSales?.toString() ?? (shift.closedAt ? "0" : null))}</td>
                    <td>{money(shift.cashRefunds?.toString() ?? (shift.closedAt ? "0" : null))}</td>
                    <td>{money(shift.expectedCash?.toString() ?? null)}</td>
                    <td>{money(shift.closingCash?.toString() ?? null)}</td>
                    <td>{money(shift.cashVariance?.toString() ?? null)}</td>
                    <td><span className={`order-status ${shift.closedAt ? "order-status-received" : "order-status-paid"}`}>{shift.closedAt ? "CLOSED" : "OPEN"}</span></td>
                  </tr>
                ))}
                {shifts.length === 0 && <tr><td className="table-empty" colSpan={9}>No register shifts have been opened at this store.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="register-shift-disclaimer">Variance equals counted cash minus expected cash (opening float + cash sales − cash refunds). Other cash movements are excluded.</p>
        </section>
      </div>
      {recentShifts > 0 && (
        <nav className="customer-directory-pagination" aria-label="Register shift history pages">
          <span>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, recentShifts)} of {recentShifts.toLocaleString("en-GH")} shifts
          </span>
          <div>
            {page > 1
              ? <Link className="button-quiet" href={`/register-shifts?page=${page - 1}`}>Previous</Link>
              : <span className="button-quiet pagination-disabled">Previous</span>}
            <span>Page {page} of {pageCount}</span>
            {page < pageCount
              ? <Link className="button-quiet" href={`/register-shifts?page=${page + 1}`}>Next</Link>
              : <span className="button-quiet pagination-disabled">Next</span>}
          </div>
        </nav>
      )}
      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
