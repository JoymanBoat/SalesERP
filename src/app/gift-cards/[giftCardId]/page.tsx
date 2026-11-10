import { notFound } from "next/navigation";
import Link from "next/link";

import { WorkspaceShell } from "@/components/workspace-shell";
import { canManagePricing } from "@/lib/permissions";
import { getPageCount, parsePage } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

const pageSize = 25;

export default async function GiftCardHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ giftCardId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ giftCardId }, { page: rawPage }] = await Promise.all([params, searchParams]);
  const { session, membership, organization, store } = await getWorkspace({ feature: "giftCards", operation: "view" });
  if (!canManagePricing(membership.role)) notFound();

  const giftCard = await prisma.giftCard.findFirst({
    where: { id: giftCardId, organizationId: organization.id },
    select: {
      id: true,
      codeLastFour: true,
      balance: true,
      initialBalance: true,
      expiresAt: true,
    },
  });
  if (!giftCard) notFound();

  const where = { organizationId: organization.id, giftCardId: giftCard.id };
  const transactionCount = await prisma.giftCardTransaction.count({ where });
  const pageCount = getPageCount(transactionCount, pageSize);
  const page = Math.min(parsePage(rawPage), pageCount);
  const rangeStart = transactionCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, transactionCount);
  const transactions = await prisma.giftCardTransaction.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      type: true,
      amountDelta: true,
      createdAt: true,
      createdById: true,
      order: { select: { number: true } },
      refund: { select: { order: { select: { number: true } } } },
    },
  });
  const creatorIds = [...new Set(transactions.flatMap((transaction) =>
    transaction.createdById ? [transaction.createdById] : [],
  ))];
  const creators = creatorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const creatorNames = new Map(creators.map((creator) => [
    creator.id,
    creator.name ?? creator.email ?? "Former user",
  ]));
  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: organization.timezone,
  });
  const pageHref = (target: number) => `/gift-cards/${giftCard.id}?page=${target}`;

  return (
    <WorkspaceShell
      activeSection="gift-cards"
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
          <p className="breadcrumbs"><Link href="/gift-cards">Gift cards</Link> / Activity</p>
          <h1>Gift card activity</h1>
          <p className="header-note">Complete value-change history for the masked card ending in {giftCard.codeLastFour}.</p>
        </div>
        <div className="header-store">
          {organization.currency} {giftCard.balance.toFixed(2)}
          <span>Current balance · Original {organization.currency} {giftCard.initialBalance.toFixed(2)}</span>
        </div>
      </header>

      <section className="data-panel gift-card-list-panel">
        <div className="panel-title-row">
          <div>
            <h2>Transaction history</h2>
            <p>{giftCard.expiresAt ? `Expiry ${giftCard.expiresAt.toISOString().slice(0, 10)}` : "No expiry date"}</p>
          </div>
          <Link className="report-export-link" href={`/gift-cards/transactions/export?giftCardId=${encodeURIComponent(giftCard.id)}`}>
            Download this card's activity CSV
          </Link>
        </div>
        <div className="table-scroll">
          <table className="data-table operational-table">
            <thead>
              <tr><th>Date and time</th><th>Event</th><th>Sale</th><th>Recorded by</th><th>Amount change</th></tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{dateFormatter.format(transaction.createdAt)}</td>
                  <td>{transaction.type.replaceAll("_", " ")}</td>
                  <td>{transaction.order?.number ?? transaction.refund?.order.number ?? "—"}</td>
                  <td>{transaction.createdById ? creatorNames.get(transaction.createdById) ?? "Former user" : "System"}</td>
                  <td>{transaction.amountDelta.isNegative() ? "−" : "+"}{organization.currency} {transaction.amountDelta.abs().toFixed(2)}</td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr><td className="table-empty" colSpan={5}>No transaction history recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {transactionCount > 0 && (
          <nav className="customer-directory-pagination" aria-label="Gift card transaction pages">
            <span>Showing {rangeStart}–{rangeEnd} of {transactionCount.toLocaleString("en-GH")} events</span>
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
      </section>
    </WorkspaceShell>
  );
}
