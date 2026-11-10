import { InventoryMovementType, Prisma } from "@prisma/client";
import Link from "next/link";

import { InventoryAdjustmentForm } from "@/components/inventory-adjustment-form";
import { InventoryCountForm } from "@/components/inventory-count-form";
import { InventoryDamageForm } from "@/components/inventory-damage-form";
import { InventoryReorderPointForm } from "@/components/inventory-reorder-point-form";
import { InventoryTransferForm } from "@/components/inventory-transfer-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canManageCatalog, canManageSuppliers } from "@/lib/permissions";
import { getPageCount, parsePage } from "@/lib/pagination";
import { quantityToReachReorderPoint } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

const pageSize = 25;
const movementPageSize = 20;

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; movementQ?: string; movementPage?: string }>;
}) {
  const { session, membership, organization, store } = await getWorkspace({ feature: "inventory", operation: "view" });
  const { q = "", status: rawStatus, page: rawPage, movementQ = "", movementPage: rawMovementPage } = await searchParams;
  const canAdjust = canManageCatalog(membership.role);
  const canCreatePurchaseOrder = canManageSuppliers(membership.role);
  const query = q.trim().slice(0, 80);
  const status = rawStatus === "low" || rawStatus === "out" ? rawStatus : "all";
  const movementQuery = movementQ.trim().slice(0, 80);
  const movementType = Object.values(InventoryMovementType).find(
    (type) => type === movementQuery.toUpperCase().replaceAll(" ", "_"),
  );
  const where: Prisma.InventoryLevelWhereInput = {
    organizationId: organization.id,
    storeId: store.id,
    ...(status === "out" ? { quantity: { lte: 0 } } : {}),
    variant: {
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { sku: { contains: query, mode: "insensitive" } },
              { barcode: { contains: query, mode: "insensitive" } },
              { product: { name: { contains: query, mode: "insensitive" } } },
              { product: { category: { is: { name: { contains: query, mode: "insensitive" } } } } },
            ],
          }
        : {}),
      product: { archivedAt: null },
    },
  };
  if (status === "low") {
    const searchPattern = `%${query}%`;
    const matchingRows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT level."id"
      FROM "InventoryLevel" AS level
      INNER JOIN "ProductVariant" AS variant ON variant."id" = level."variantId"
      INNER JOIN "Product" AS product ON product."id" = variant."productId"
      LEFT JOIN "Category" AS category ON category."id" = product."categoryId"
      WHERE level."organizationId" = ${organization.id}
        AND level."storeId" = ${store.id}
        AND product."archivedAt" IS NULL
        AND level."quantity" > 0
        AND level."quantity" <= level."reorderPoint"
        AND (
          ${query} = ''
          OR variant."name" ILIKE ${searchPattern}
          OR variant."sku" ILIKE ${searchPattern}
          OR variant."barcode" ILIKE ${searchPattern}
          OR product."name" ILIKE ${searchPattern}
          OR category."name" ILIKE ${searchPattern}
        )
    `);
    where.id = { in: matchingRows.map(({ id }) => id) };
  }

  const movementWhere: Prisma.InventoryMovementWhereInput = {
    organizationId: organization.id,
    storeId: store.id,
    ...(movementQuery
      ? {
          OR: [
            { reason: { contains: movementQuery, mode: "insensitive" } },
            { variant: { sku: { contains: movementQuery, mode: "insensitive" } } },
            { variant: { product: { name: { contains: movementQuery, mode: "insensitive" } } } },
            ...(movementType ? [{ type: movementType }] : []),
          ],
        }
      : {}),
  };
  const [levelCount, summaryRows, movementCount, receiptCount] = await Promise.all([
    prisma.inventoryLevel.count({ where }),
    prisma.$queryRaw<{ tracked: bigint; totalUnits: bigint; lowStockCount: bigint; outOfStockCount: bigint }[]>`
      SELECT
        COUNT(*)::bigint AS tracked,
        COALESCE(SUM("quantity"), 0)::bigint AS "totalUnits",
        COUNT(*) FILTER (WHERE "quantity" <= "reorderPoint")::bigint AS "lowStockCount",
        COUNT(*) FILTER (WHERE "quantity" <= 0)::bigint AS "outOfStockCount"
      FROM "InventoryLevel" AS level
      INNER JOIN "ProductVariant" AS variant ON variant."id" = level."variantId"
      INNER JOIN "Product" AS product ON product."id" = variant."productId"
      WHERE level."organizationId" = ${organization.id}
        AND level."storeId" = ${store.id}
        AND product."archivedAt" IS NULL
    `,
    prisma.inventoryMovement.count({ where: movementWhere }),
    prisma.inventoryMovement.count({
      where: { organizationId: organization.id, storeId: store.id, type: InventoryMovementType.RECEIPT },
    }),
  ]);
  const [transferStores, transfers] = await Promise.all([
    prisma.store.findMany({
      where: { organizationId: organization.id, active: true, id: { not: store.id } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.stockTransfer.findMany({
      where: { organizationId: organization.id, OR: [{ fromStoreId: store.id }, { toStoreId: store.id }] },
      include: {
        variant: { include: { product: { select: { name: true } } } },
        fromStore: { select: { name: true } },
        toStore: { select: { name: true } },
        createdBy: { select: { name: true, email: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
    }),
  ]);
  const pageCount = getPageCount(levelCount, pageSize);
  const page = Math.min(parsePage(rawPage), pageCount);
  const movementPageCount = getPageCount(movementCount, movementPageSize);
  const movementPage = Math.min(parsePage(rawMovementPage), movementPageCount);
  const recentMovements = await prisma.inventoryMovement.findMany({
    where: movementWhere,
    include: {
      variant: { include: { product: true } },
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (movementPage - 1) * movementPageSize,
    take: movementPageSize,
  });
  const levels = await prisma.inventoryLevel.findMany({
    where,
    include: {
      variant: { include: { product: true } },
    },
    orderBy: [{ quantity: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  // The transfer form lists only the variants on this page so the payload stays bounded for large catalogs.
  const availableTransferVariants = levels.map((level) => ({
    id: level.variantId,
    name: level.variant.name,
    sku: level.variant.sku,
    productName: level.variant.product.name,
    available: level.quantity - level.reserved,
  }));
  const summary = summaryRows[0];
  const movementClearParams = new URLSearchParams();
  if (query) movementClearParams.set("q", query);
  if (status !== "all") movementClearParams.set("status", status);
  if (page > 1) movementClearParams.set("page", String(page));
  const movementClearHref = movementClearParams.size
    ? `/inventory?${movementClearParams.toString()}`
    : "/inventory";
  const exportParams = new URLSearchParams();
  if (query) exportParams.set("q", query);
  if (status !== "all") exportParams.set("status", status);
  const exportHref = `/inventory/export${exportParams.size ? `?${exportParams.toString()}` : ""}`;
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status !== "all") params.set("status", status);
    params.set("page", String(target));
    if (movementQuery) params.set("movementQ", movementQuery);
    if (movementPage > 1) params.set("movementPage", String(movementPage));
    return `/inventory?${params.toString()}`;
  };
  const movementHref = (target: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status !== "all") params.set("status", status);
    if (page > 1) params.set("page", String(page));
    if (movementQuery) params.set("movementQ", movementQuery);
    if (target > 1) params.set("movementPage", String(target));
    return `/inventory?${params.toString()}`;
  };
  const rangeStart = levelCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, levelCount);
  const movementRangeStart = movementCount === 0 ? 0 : (movementPage - 1) * movementPageSize + 1;
  const movementRangeEnd = Math.min(movementPage * movementPageSize, movementCount);

  return (
    <WorkspaceShell
      activeSection="inventory"
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
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Inventory</p>
          <h1>Inventory control</h1>
          <p className="header-note">Stock levels and traceable adjustments for {store.name}.</p>
        </div>
        <div className="header-store">{Number(summary?.totalUnits ?? 0n).toLocaleString("en-GH")} units<span>Current on-hand total</span></div>
      </header>

      <div className="section-heading">
        <div><p className="eyebrow">Stock health</p><h2>Store inventory</h2></div>
        <span className="data-source-note">Live stock ledger · {levelCount.toLocaleString("en-GH")} variants</span>
      </div>

      <section className="inventory-summary" aria-label="Inventory summary">
        <article className="inventory-summary-card"><span>Tracked variants</span><strong>{Number(summary?.tracked ?? 0n).toLocaleString("en-GH")}</strong></article>
        <article className="inventory-summary-card"><span>At or below reorder point</span><strong className={Number(summary?.lowStockCount ?? 0n) ? "stock-low" : ""}>{Number(summary?.lowStockCount ?? 0n).toLocaleString("en-GH")}</strong></article>
        <article className="inventory-summary-card"><span>Out of stock</span><strong className={Number(summary?.outOfStockCount ?? 0n) ? "stock-low" : ""}>{Number(summary?.outOfStockCount ?? 0n).toLocaleString("en-GH")}</strong></article>
        <article className="inventory-summary-card"><span>Receipts recorded</span><strong>{receiptCount.toLocaleString("en-GH")}</strong></article>
      </section>

      <section className="data-panel inventory-table-panel">
        <div className="panel-title-row">
          <div><h2>Stock by product</h2><p>Quantity changes are recorded with an audit trail.</p></div>
          <div className="inventory-table-actions">
            <Link className="report-export-link" href={exportHref}>Export CSV</Link>
            <span className="table-count">{rangeStart}–{rangeEnd} of {levelCount.toLocaleString("en-GH")}</span>
          </div>
        </div>
        <form className="search-form inventory-search-form" method="get" role="search">
          <label className="visually-hidden" htmlFor="inventory-search">Search products by name, SKU, barcode, or category</label>
          <input id="inventory-search" name="q" type="search" defaultValue={query} placeholder="Search product, SKU, barcode, or category..." maxLength={80} />
          <label className="visually-hidden" htmlFor="inventory-status">Filter by stock status</label>
          <select id="inventory-status" name="status" defaultValue={status}>
            <option value="all">All stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
          {movementQuery && <input type="hidden" name="movementQ" value={movementQuery} />}
          {movementPage > 1 && <input type="hidden" name="movementPage" value={movementPage} />}
          <button className="button-quiet" type="submit">Apply</button>
          {(query || status !== "all") && <Link className="clear-search" href={movementQuery ? `/inventory?${new URLSearchParams({ movementQ: movementQuery, ...(movementPage > 1 ? { movementPage: String(movementPage) } : {}) }).toString()}` : "/inventory"}>Clear</Link>}
        </form>
        <div className="table-scroll">
          <table className="data-table operational-table">
            <thead><tr><th>Product</th><th>SKU</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Reorder point</th><th>To reorder point</th><th>Updated</th>{canAdjust && <th>Stock actions</th>}</tr></thead>
            <tbody>
              {levels.map((level) => {
                const lowStock = level.quantity <= level.reorderPoint;
                return (
                  <tr key={level.id}>
                    <td><strong>{level.variant.product.name}</strong><small className="table-secondary">{level.variant.name}</small></td>
                    <td>{level.variant.sku}</td>
                    <td><span className={`stock-value${lowStock ? " stock-low" : ""}`}>{level.quantity}</span></td>
                    <td>{level.reserved}</td>
                    <td>{Math.max(0, level.quantity - level.reserved)}</td>
                    <td>{canAdjust
                      ? <InventoryReorderPointForm key={`${level.id}-${level.reorderPoint}`} variantId={level.variantId} reorderPoint={level.reorderPoint} />
                      : level.reorderPoint}</td>
                    <td>{quantityToReachReorderPoint(Math.max(0, level.quantity - level.reserved), level.reorderPoint)}</td>
                    <td>{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeZone: organization.timezone }).format(level.updatedAt)}</td>
                    {canAdjust && <td>
                      <InventoryAdjustmentForm key={level.id} variantId={level.variantId} />
                      <InventoryCountForm variantId={level.variantId} quantity={level.quantity} />
                      <InventoryDamageForm variantId={level.variantId} available={Math.max(0, level.quantity - level.reserved)} />
                      {canCreatePurchaseOrder && quantityToReachReorderPoint(Math.max(0, level.quantity - level.reserved), level.reorderPoint) > 0 && (
                        <Link
                          className="inventory-order-link"
                          href={`/purchasing?restockVariant=${encodeURIComponent(level.variantId)}&restockQuantity=${quantityToReachReorderPoint(Math.max(0, level.quantity - level.reserved), level.reorderPoint)}`}
                        >
                          Order {quantityToReachReorderPoint(Math.max(0, level.quantity - level.reserved), level.reorderPoint)}
                        </Link>
                      )}
                    </td>}
                  </tr>
                );
              })}
              {levels.length === 0 && <tr><td className="table-empty" colSpan={canAdjust ? 9 : 8}>{query || status !== "all"
                ? `No stock items match the selected search and status${query ? ` for “${query}”` : ""}.`
                : <>No inventory tracked yet. <Link href="/products">Add your first product</Link> to create its stock record.</>}</td></tr>}
            </tbody>
          </table>
        </div>
        {levelCount > 0 && (
          <nav className="customer-directory-pagination inventory-pagination" aria-label="Inventory pages">
            <span>Showing {rangeStart}–{rangeEnd} of {levelCount.toLocaleString("en-GH")}{query ? ` matching “${query}”` : ""}{status !== "all" ? ` · ${status === "low" ? "low stock" : "out of stock"}` : ""}</span>
            <div>
              {page > 1 ? <Link className="button-quiet" href={pageHref(page - 1)}>Previous</Link> : <span className="button-quiet pagination-disabled">Previous</span>}
              <span>Page {page} of {pageCount}</span>
              {page < pageCount ? <Link className="button-quiet" href={pageHref(page + 1)}>Next</Link> : <span className="button-quiet pagination-disabled">Next</span>}
            </div>
          </nav>
        )}
      </section>

      <section className="data-panel movement-panel">
        <div className="panel-title-row"><div><h2>Stock movement history</h2><p>Auditable receipts and adjustments across this store.</p></div><span className="table-count">{movementCount.toLocaleString("en-GH")} movements</span></div>
        <form className="search-form" method="get" role="search">
          <label className="visually-hidden" htmlFor="movement-search">Search movements by product, SKU, exact movement type, or reason</label>
          <input id="movement-search" name="movementQ" type="search" defaultValue={movementQuery} placeholder="Search product, SKU, exact type, or reason..." maxLength={80} />
          {query && <input type="hidden" name="q" value={query} />}
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          {page > 1 && <input type="hidden" name="page" value={page} />}
          <button className="button-quiet" type="submit">Search</button>
          {movementQuery && <Link className="clear-search" href={movementClearHref}>Clear</Link>}
        </form>
        <div className="movement-list">
          {recentMovements.map((movement) => (
            <article className="movement-item" key={movement.id}>
              <span className={`movement-sign${movement.quantityDelta < 0 ? " negative" : ""}`}>{movement.quantityDelta > 0 ? "+" : ""}{movement.quantityDelta}</span>
              <div><strong>{movement.variant.product.name}</strong><span>{movement.variant.sku} · {movement.reason ?? movement.type.replaceAll("_", " ")}</span></div>
              <span className="movement-actor">{movement.createdBy?.name ?? movement.createdBy?.email ?? "System"}<small>{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: organization.timezone }).format(movement.createdAt)}</small></span>
            </article>
          ))}
          {recentMovements.length === 0 && <p className="movement-empty">{movementQuery ? `No stock movements match “${movementQuery}”.` : "Stock receipts and adjustments will appear here as they are recorded."}</p>}
        </div>
        {movementCount > 0 && (
          <nav className="customer-directory-pagination inventory-pagination" aria-label="Stock movement pages">
            <span>Showing {movementRangeStart}–{movementRangeEnd} of {movementCount.toLocaleString("en-GH")}{movementQuery ? ` matching “${movementQuery}”` : ""}</span>
            <div>
              {movementPage > 1 ? <Link className="button-quiet" href={movementHref(movementPage - 1)}>Previous</Link> : <span className="button-quiet pagination-disabled">Previous</span>}
              <span>Page {movementPage} of {movementPageCount}</span>
              {movementPage < movementPageCount ? <Link className="button-quiet" href={movementHref(movementPage + 1)}>Next</Link> : <span className="button-quiet pagination-disabled">Next</span>}
            </div>
          </nav>
        )}
      </section>
      {canAdjust && (
        <section className="data-panel transfer-panel">
          <div className="panel-title-row">
            <div><h2>Transfer between stores</h2><p>Transfers update both store balances and ledgers in one transaction.</p></div>
            <span className="table-count">{store.name} · source</span>
          </div>
          <div className="transfer-content">
            {transferStores.length > 0
              ? <InventoryTransferForm variants={availableTransferVariants} stores={transferStores} />
              : <p className="permission-note">Add another active store to enable stock transfers.</p>}
            <div className="transfer-history">
              <h3>Recent transfers</h3>
              {transfers.length > 0 ? transfers.map((transfer) => (
                <article className="transfer-history-item" key={transfer.id}>
                  <strong>{transfer.variant.product.name} · {transfer.variant.name}</strong>
                  <span>{transfer.quantity} units · {transfer.fromStore.name} → {transfer.toStore.name}</span>
                  <small>{transfer.reason ?? ""}{transfer.createdBy ? ` · ${transfer.createdBy.name ?? transfer.createdBy.email}` : ""} · {new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: organization.timezone }).format(transfer.createdAt)}</small>
                </article>
              )) : <p className="movement-empty">Completed store transfers will appear here.</p>}
            </div>
          </div>
        </section>
      )}
      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
