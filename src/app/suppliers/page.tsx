import type { Prisma } from "@prisma/client";
import Link from "next/link";

import { SupplierForm } from "@/components/supplier-form";
import { SupplierRow } from "@/components/supplier-row";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canManageSuppliers } from "@/lib/permissions";
import { getPageCount, parsePage } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

const pageSize = 25;

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; notice?: string }>;
}) {
  const { session, membership, organization, store } = await getWorkspace({ feature: "suppliers", operation: "view" });
  const { q = "", status, page: rawPage, notice } = await searchParams;
  const showInactive = status === "inactive";
  const query = q.trim().slice(0, 80);
  const where: Prisma.SupplierWhereInput = {
    organizationId: organization.id,
    archivedAt: showInactive ? { not: null } : null,
    ...(query
      ? {
          OR: [
            { businessName: { contains: query, mode: "insensitive" } },
            { contactName: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            { phone: { contains: query, mode: "insensitive" } },
            { address: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const supplierCount = await prisma.supplier.count({ where });
  const pageCount = getPageCount(supplierCount, pageSize);
  const page = Math.min(parsePage(rawPage), pageCount);
  const suppliers = await prisma.supplier.findMany({
    where,
    orderBy: [{ businessName: "asc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  const canManage = canManageSuppliers(membership.role);

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (showInactive) params.set("status", "inactive");
    params.set("page", String(targetPage));
    return `/suppliers?${params.toString()}`;
  }

  return (
    <WorkspaceShell
      activeSection="suppliers"
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
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Suppliers</p>
          <h1>Supplier directory</h1>
          <p className="header-note">{showInactive ? "Inactive supplier records" : "Supplier contacts and business details"} for {organization.name}.</p>
        </div>
        <div className="header-store">{supplierCount.toLocaleString("en-GH")} suppliers<span>{showInactive ? "Inactive records" : "Business directory"}</span></div>
      </header>

      <div className="section-heading">
        <div><p className="eyebrow">Purchasing relationships</p><h2>Suppliers</h2></div>
        <Link className="customer-filter-link" href={showInactive ? "/suppliers" : "/suppliers?status=inactive"}>
          {showInactive ? "View active suppliers" : "View inactive suppliers"}
        </Link>
      </div>

      <div className="catalog-layout">
        <section className="data-panel catalog-table-panel">
          {(notice === "deactivated" || notice === "reactivated") && (
            <p className="form-success customer-notice" role="status">
              {notice === "deactivated" ? "Supplier deactivated." : "Supplier reactivated."}
            </p>
          )}
          <form className="search-form" method="get" role="search">
            <label className="visually-hidden" htmlFor="supplier-search">Search suppliers by business, contact, email, phone, or address</label>
            {showInactive && <input type="hidden" name="status" value="inactive" />}
            <input id="supplier-search" name="q" type="search" defaultValue={query} placeholder="Search business, contact, email, or phone..." maxLength={80} />
            <button className="button-quiet" type="submit">Search</button>
            {query && <Link className="clear-search" href={showInactive ? "/suppliers?status=inactive" : "/suppliers"}>Clear</Link>}
          </form>

          <div className="table-scroll">
            <table className="data-table operational-table">
              <thead><tr><th>Supplier</th><th>Contact</th><th>Address</th>{canManage && <th>Actions</th>}</tr></thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <SupplierRow key={supplier.id} supplier={supplier} canManage={canManage} showInactive={showInactive} />
                ))}
                {suppliers.length === 0 && (
                  <tr><td className="table-empty" colSpan={canManage ? 4 : 3}>
                    {query ? `No suppliers match “${query}”.` : showInactive ? "No inactive suppliers." : "No suppliers yet. Add your first supplier to start tracking purchasing relationships."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="form-panel">
          <p className="eyebrow">Purchasing contacts</p>
          <h2>New supplier</h2>
          <p className="form-intro">Keep your supplier business and contact details available to your team.</p>
          {canManage && !showInactive
            ? <SupplierForm />
            : !canManage
              ? <p className="permission-note">Your role can view supplier records, but cannot manage them.</p>
              : <p className="permission-note">Switch to the active directory to add or edit suppliers.</p>}
        </aside>
      </div>
      {supplierCount > 0 && (
        <nav className="customer-directory-pagination" aria-label="Supplier directory pages">
          <span>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, supplierCount)} of {supplierCount.toLocaleString("en-GH")} suppliers
          </span>
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
      <footer className="workspace-footer"><span>{organization.name}</span><span>Supplier records are shared across your business locations.</span></footer>
    </WorkspaceShell>
  );
}
