import Link from "next/link";

import { PromotionManager } from "@/components/promotion-manager";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canManagePricing } from "@/lib/permissions";
import { getPageCount, parsePage } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

const pageSize = 25;

export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { session, membership, organization, store } = await getWorkspace({ feature: "promotions", operation: "view" });
  const { page: rawPage } = await searchParams;
  const canManage = canManagePricing(membership.role);
  const [promotionCount, activePromotionCount, products] = await Promise.all([
    prisma.promotion.count({ where: { organizationId: organization.id } }),
    prisma.promotion.count({ where: { organizationId: organization.id, active: true } }),
    canManage
      ? prisma.product.findMany({
          where: { organizationId: organization.id, archivedAt: null },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 500,
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const pageCount = getPageCount(promotionCount, pageSize);
  const page = Math.min(parsePage(rawPage), pageCount);
  const promotions = await prisma.promotion.findMany({
    where: { organizationId: organization.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      value: true,
      minimumSubtotal: true,
      startsOn: true,
      endsOn: true,
      maxRedemptions: true,
      redemptionCount: true,
      active: true,
      products: { select: { productId: true, product: { select: { name: true } } } },
    },
  });

  return (
    <WorkspaceShell
      activeSection="promotions"
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
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Promotions</p>
          <h1>POS promotions</h1>
          <p className="header-note">Manage fixed and percentage offer codes for sales across your business.</p>
        </div>
        <div className="header-store">{activePromotionCount.toLocaleString("en-GH")} active<span>Organization-wide</span></div>
      </header>
      {canManage
        ? <PromotionManager promotions={promotions.map((promotion) => ({
            ...promotion,
            products: promotion.products.map(({ productId, product }) => ({ id: productId, name: product.name })),
            value: promotion.value.toString(),
            minimumSubtotal: promotion.minimumSubtotal.toString(),
            startsOn: promotion.startsOn?.toISOString().slice(0, 10) ?? null,
            endsOn: promotion.endsOn?.toISOString().slice(0, 10) ?? null,
          }))} currency={organization.currency} products={products} totalCount={promotionCount} />
        : <>
            <p className="permission-note">Your role can view promotion codes but cannot create or change them.</p>
            <section className="data-panel">
                <h2>Promotion codes</h2>
                <div className="table-scroll">
                  <table className="data-table operational-table">
                    <thead><tr><th>Promotion</th><th>Discount</th><th>Validity</th><th>Redemptions</th><th>Status</th></tr></thead>
                    <tbody>
                      {promotions.map((promotion) => (
                        <tr key={promotion.id}>
                          <td><strong>{promotion.name}</strong><small className="table-secondary">{promotion.code}</small></td>
                          <td>{promotion.type === "PERCENTAGE" ? `${Number(promotion.value).toFixed(2)}%` : `${organization.currency} ${Number(promotion.value).toFixed(2)}`}</td>
                          <td>{promotion.startsOn || promotion.endsOn ? `${promotion.startsOn?.toISOString().slice(0, 10) ?? "Any date"} – ${promotion.endsOn?.toISOString().slice(0, 10) ?? "No end"}` : "Always"}</td>
                          <td>{promotion.redemptionCount}{promotion.maxRedemptions === null ? " / unlimited" : ` / ${promotion.maxRedemptions}`}</td>
                          <td>{promotion.active ? "Active" : "Inactive"}</td>
                        </tr>
                      ))}
                      {promotions.length === 0 && <tr><td className="table-empty" colSpan={5}>No promotions yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
            </section>
          </>}
      {promotionCount > 0 && (
        <nav className="customer-directory-pagination" aria-label="Promotion pages">
          <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, promotionCount)} of {promotionCount.toLocaleString("en-GH")} promotions</span>
          <div>
            {page > 1 ? <Link className="button-quiet" href={`/promotions?page=${page - 1}`}>Previous</Link> : <span className="button-quiet pagination-disabled">Previous</span>}
            <span>Page {page} of {pageCount}</span>
            {page < pageCount ? <Link className="button-quiet" href={`/promotions?page=${page + 1}`}>Next</Link> : <span className="button-quiet pagination-disabled">Next</span>}
          </div>
        </nav>
      )}
      <footer className="workspace-footer"><span>{organization.name}</span><span>Codes are available at all active registers.</span></footer>
    </WorkspaceShell>
  );
}
