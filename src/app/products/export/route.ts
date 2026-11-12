import { toCsvCell } from "@/lib/reporting";
import { buildProductWhere } from "@/lib/catalog";
import { getWorkspace } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

const batchSize = 200;
const headers = [
  "Product ID",
  "Product name",
  "Description",
  "Brand",
  "Category",
  "Variant",
  "SKU",
  "Barcode",
  "Unit price",
  "Cost price",
  "Track inventory",
  "On hand",
  "Reorder point",
  "Status",
];

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const workspaceOrganizationId = searchParams.get("workspaceOrganizationId");
  const { organization, store } = await getWorkspace({
    feature: "inventory",
    ...(workspaceOrganizationId !== null ? { organizationId: workspaceOrganizationId } : {}),
    operation: "view",
  });
  const query = (searchParams.get("q") ?? "").trim().slice(0, 80);
  const showArchived = searchParams.get("status") === "archived";
  const where = {
    organizationId: organization.id,
    ...buildProductWhere(query, showArchived),
  };
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  let headerPending = true;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (headerPending) {
        controller.enqueue(encoder.encode(`\uFEFF${headers.map(toCsvCell).join(",")}\r\n`));
        headerPending = false;
        return;
      }

      const products = await prisma.product.findMany({
        where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: batchSize,
        include: {
          category: { select: { name: true } },
          variants: {
            orderBy: { id: "asc" },
            include: {
              inventoryLevels: {
                where: { organizationId: organization.id, storeId: store.id },
                select: { quantity: true, reorderPoint: true },
                take: 1,
              },
            },
          },
        },
      });

      if (products.length === 0) {
        controller.close();
        return;
      }

      cursor = products[products.length - 1].id;
      const rows = products.flatMap((product) =>
        product.variants.map((variant) => {
          const level = variant.inventoryLevels[0];
          return [
            product.id,
            product.name,
            product.description ?? "",
            product.brand ?? "",
            product.category?.name ?? "",
            variant.name,
            variant.sku,
            variant.barcode ?? "",
            variant.unitPrice.toString(),
            variant.costPrice?.toString() ?? "",
            variant.trackInventory ? "true" : "false",
            level?.quantity ?? 0,
            level?.reorderPoint ?? 0,
            product.archivedAt ? "archived" : "active",
          ].map(toCsvCell).join(",");
        }),
      );
      if (rows.length > 0) controller.enqueue(encoder.encode(`${rows.join("\r\n")}\r\n`));
      if (products.length < batchSize) controller.close();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products-${showArchived ? "archived" : "active"}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
