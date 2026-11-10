import { Prisma } from "@prisma/client";
import Link from "next/link";

import { GiftCardManager } from "@/components/gift-card-manager";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canManagePricing } from "@/lib/permissions";
import { getPageCount, parsePage } from "@/lib/pagination";
import { businessDateInTimeZone } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

const pageSize = 20;

export default async function GiftCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  const { page: rawPage, q = "", status } = await searchParams;
  const { session, membership, organization, store } = await getWorkspace({ feature: "giftCards", operation: "view" });
  const canManage = canManagePricing(membership.role);
  const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
  const businessDateStart = new Date(`${businessDate}T00:00:00.000Z`);
  const query = q.trim().slice(0, 4);
  const statusFilter = status === "active" || status === "inactive" || status === "expired" ? status : "";
  const where: Prisma.GiftCardWhereInput = {
    organizationId: organization.id,
    ...(query ? { codeLastFour: { contains: query, mode: "insensitive" } } : {}),
    ...(statusFilter === "active"
      ? {
          active: true,
          OR: [{ expiresAt: null }, { expiresAt: { gte: businessDateStart } }],
        }
      : statusFilter === "inactive"
        ? { active: false }
        : statusFilter === "expired"
          ? { active: true, expiresAt: { lt: businessDateStart } }
          : {}),
  };
  const [cardCount, activeCardCount] = canManage ? await Promise.all([
    prisma.giftCard.count({ where }),
    prisma.giftCard.count({
      where: {
        organizationId: organization.id,
        active: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: businessDateStart } },
        ],
      },
    }),
  ]) : [0, 0];
  const pageCount = getPageCount(cardCount, pageSize);
  const page = Math.min(parsePage(rawPage), pageCount);
  const rangeStart = cardCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, cardCount);
  const cards = canManage ? await prisma.giftCard.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        codeLastFour: true,
        initialBalance: true,
        balance: true,
        active: true,
        expiresAt: true,
        createdAt: true,
        transactions: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 6,
          select: {
            id: true,
            type: true,
            amountDelta: true,
            createdAt: true,
            createdById: true,
            order: { select: { number: true } },
            refund: { select: { order: { select: { number: true } } } },
          },
        },
      },
    }) : [];
  const creatorIds = [...new Set(cards.flatMap((card) =>
    card.transactions.flatMap((transaction) => transaction.createdById ? [transaction.createdById] : []),
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
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Gift cards</p>
          <h1>Stored-value gift cards</h1>
          <p className="header-note">Issue and manage GHS gift cards redeemable at your business's POS registers.</p>
        </div>
        <div className="header-store">
          {activeCardCount} active
          <span>Organization-wide</span>
        </div>
      </header>
      {canManage
        ? <GiftCardManager
            cards={cards.map((card) => ({
              ...card,
              initialBalance: card.initialBalance.toString(),
              balance: card.balance.toString(),
              expiresOn: card.expiresAt?.toISOString().slice(0, 10) ?? null,
              expired: Boolean(card.expiresAt && card.expiresAt.toISOString().slice(0, 10) < businessDate),
              createdAt: card.createdAt.toISOString(),
              hasMoreTransactions: card.transactions.length > 5,
              transactions: card.transactions.slice(0, 5).map((transaction) => ({
                id: transaction.id,
                type: transaction.type,
                amountDelta: transaction.amountDelta.toString(),
                createdBy: transaction.createdById ? creatorNames.get(transaction.createdById) ?? "Former user" : "System",
                recordedAt: new Intl.DateTimeFormat("en-GH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: organization.timezone,
                }).format(transaction.createdAt),
                orderNumber: transaction.order?.number ?? transaction.refund?.order.number ?? null,
              })),
            }))}
            currency={organization.currency}
            businessDate={businessDate}
            page={page}
            pageCount={pageCount}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            totalCount={cardCount}
            query={query}
            statusFilter={statusFilter}
          />
        : <p className="permission-note">Only an owner or manager can manage stored-value gift cards.</p>}
      <footer className="workspace-footer"><span>{organization.name}</span><span>Codes are stored as hashes and shown only once at issue.</span></footer>
    </WorkspaceShell>
  );
}
