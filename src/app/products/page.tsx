import type { Prisma } from "@prisma/client";
import Link from "next/link";

import { ProductForm } from "@/components/product-form";
import { ProductImportForm } from "@/components/product-import-form";
import { ProductOptionsManager } from "@/components/product-options-manager";
import { ProductRow } from "@/components/product-row";
import { ProductVariantsManager } from "@/components/product-variants-manager";
import { WorkspaceShell } from "@/components/workspace-shell";
import { buildProductWhere } from "@/lib/catalog";
import { getPageCount, parsePage } from "@/lib/pagination";
import { canManageCatalog } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

const pageSize = 25;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; notice?: string }>;
}) {
  const { session, membership, organization, store } = await getWorkspace({ feature: "inventory", operation: "view" });
  const { q = "", status, page: rawPage, notice } = await searchParams;
  const showArchived = status === "archived";
  const query = q.trim().slice(0, 80);
  const canManage = canManageCatalog(membership.role);
  const where: Prisma.ProductWhereInput = {
    organizationId: organization.id,
    ...buildProductWhere(query, showArchived),
  };
  const [productCount, productOptions, categories] = await Promise.all([
    prisma.product.count({ where }),
    prisma.productOption.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.category.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    }),
  ]);
  const pageCount = getPageCount(productCount, pageSize);
  const page = Math.min(parsePage(rawPage), pageCount);
  const products = await prisma.product.findMany({
    where,
    include: {
      category: true,
      variants: {
        orderBy: { createdAt: "asc" },
        include: {
          optionValues: { include: { option: { select: { name: true } } } },
          inventoryLevels: {
            where: { organizationId: organization.id, storeId: store.id },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (showArchived) params.set("status", "archived");
    params.set("page", String(targetPage));
    return `/products?${params.toString()}`;
  }

  return (
    <WorkspaceShell
      activeSection="products"
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
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Products</p>
          <h1>Product catalog</h1>
          <p className="header-note">{showArchived ? `Review archived products for ${store.name}.` : `Manage the items and prices available in ${store.name}.`}</p>
        </div>
        <div className="header-store">{productCount.toLocaleString("en-GH")} products<span>{showArchived ? "Archived catalog" : "Active catalog"}</span></div>
      </header>

      <div className="section-heading">
        <div><p className="eyebrow">Catalog management</p><h2>Products</h2></div>
        <div className="catalog-actions">
          <a className="customer-filter-link" href={`/products/export?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(showArchived ? { status: "archived" } : {}) }).toString()}`}>Export CSV</a>
          <Link className="customer-filter-link" href={showArchived ? "/products" : "/products?status=archived"}>
            {showArchived ? "View active products" : "View archived products"}
          </Link>
        </div>
      </div>

      {canManage && !showArchived && <ProductOptionsManager options={productOptions} />}

      <div className="catalog-layout">
        <section className="data-panel catalog-table-panel">
          {(notice === "archived" || notice === "reactivated") && (
            <p className="form-success customer-notice" role="status">
              {notice === "archived" ? "Product archived. Stock and sales history are preserved." : "Product restored to the active catalog."}
            </p>
          )}
          <form className="search-form" method="get" role="search">
            <label className="visually-hidden" htmlFor="product-search">Search products, SKUs, barcodes, or categories</label>
            {showArchived && <input type="hidden" name="status" value="archived" />}
            <input id="product-search" name="q" type="search" defaultValue={query} placeholder="Search products, SKUs, barcodes..." maxLength={80} />
            <button className="button-quiet" type="submit">Search</button>
            {query && <Link className="clear-search" href={showArchived ? "/products?status=archived" : "/products"}>Clear</Link>}
          </form>

          <div className="table-scroll">
            <table className="data-table operational-table">
              <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Price</th><th>On hand</th>{canManage && <th>Actions</th>}</tr></thead>
              <tbody>
                {products.map((product) => {
                  return (
                    <ProductRow
                      key={product.id}
                      product={{
                        ...product,
                        variants: product.variants.map((variant) => ({
                          ...variant,
                          unitPrice: variant.unitPrice.toString(),
                          costPrice: variant.costPrice?.toString() ?? null,
                        })),
                      }}
                      canManage={canManage}
                      categories={categories}
                      showArchived={showArchived}
                      variantsManager={
                        canManage && !showArchived
                          ? <ProductVariantsManager
                              productId={product.id}
                              variants={product.variants.map((variant) => ({
                                ...variant,
                                unitPrice: variant.unitPrice.toString(),
                                costPrice: variant.costPrice?.toString() ?? null,
                                optionValues: variant.optionValues.map(({ optionId, value, option }) => ({
                                  optionId,
                                  value,
                                  option,
                                })),
                              }))}
                              options={productOptions}
                            />
                          : null
                      }
                    />
                  );
                })}
                {products.length === 0 && (
                  <tr><td className="table-empty" colSpan={canManage ? 6 : 5}>{query ? `No products match “${query}”.` : showArchived ? "No archived products." : "No products yet. Add your first product to start tracking stock."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {!showArchived && <aside className="form-panel">
          <p className="eyebrow">Add to catalog</p>
          <h2>New product</h2>
          <p className="form-intro">Creates a default variant and opening stock for this store. SKU must be unique in your business.</p>
          {canManage
            ? <><ProductForm categories={categories} />{membership.role === "OWNER" && <p className="form-intro"><Link href="/settings#categories">Manage item categories in Settings</Link></p>}</>
            : <p className="permission-note">Your role can view the catalog, but cannot create products.</p>}
        </aside>}
      </div>
      {productCount > 0 && (
        <nav className="customer-directory-pagination" aria-label="Product catalog pages">
          <span>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, productCount)} of {productCount.toLocaleString("en-GH")} products
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
      {canManage && (
        <section className="data-panel product-import-panel">
          <div>
            <p className="eyebrow">Bulk catalog</p>
            <h2>Import products</h2>
            <p className="form-intro">Create new products from a CSV template. Existing products and inventory are never overwritten.</p>
            <a className="customer-filter-link" href="/products/import/template">Download CSV template</a>
          </div>
          <ProductImportForm />
        </section>
      )}
      <footer className="workspace-footer"><span>{organization.name}</span><span>Prices shown in {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
