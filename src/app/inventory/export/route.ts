import { Prisma } from "@prisma/client";

import { toCsvCell } from "@/lib/reporting";
import { quantityToReachReorderPoint } from "@/lib/inventory";
import { getWorkspace } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

const batchSize = 500;
const headers = [
  "Store",
  "Product",
  "Variant",
  "SKU",
  "Barcode",
  "On hand",
  "Reserved",
  "Available",
  "Reorder point",
  "Qty to reach reorder point",
  "Status",
];

export async function GET(request: Request) {
  const { organization, store } = await getWorkspace({ feature: "inventory", operation: "view" });
  const searchParams = new URL(request.url).searchParams;
  const query = (searchParams.get("q") ?? "").trim().slice(0, 80);
  const requestedStatus = searchParams.get("status");
  const status = requestedStatus === "low" || requestedStatus === "out" ? requestedStatus : "all";
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  let headerPending = true;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (headerPending) {
          controller.enqueue(encoder.encode(`\uFEFF${headers.map(toCsvCell).join(",")}\r\n`));
          headerPending = false;
          return;
        }

        const searchCondition = query
          ? Prisma.sql`AND (
              strpos(lower(variant."name"), lower(${query})) > 0
              OR strpos(lower(variant."sku"), lower(${query})) > 0
              OR strpos(lower(COALESCE(variant."barcode", '')), lower(${query})) > 0
              OR strpos(lower(product."name"), lower(${query})) > 0
              OR strpos(lower(COALESCE(category."name", '')), lower(${query})) > 0
            )`
          : Prisma.empty;
        const statusCondition = status === "low"
          ? Prisma.sql`AND level."quantity" > 0 AND level."quantity" <= level."reorderPoint"`
          : status === "out"
            ? Prisma.sql`AND level."quantity" <= 0`
            : Prisma.empty;
        const cursorCondition = cursor
          ? Prisma.sql`AND level."id" > ${cursor}`
          : Prisma.empty;
        const rows = await prisma.$queryRaw<{
          id: string;
          productName: string;
          variantName: string;
          sku: string;
          barcode: string | null;
          quantity: number;
          reserved: number;
          reorderPoint: number;
        }[]>(Prisma.sql`
          SELECT
            level."id",
            product."name" AS "productName",
            variant."name" AS "variantName",
            variant."sku",
            variant."barcode",
            level."quantity",
            level."reserved",
            level."reorderPoint"
          FROM "InventoryLevel" AS level
          INNER JOIN "ProductVariant" AS variant ON variant."id" = level."variantId"
          INNER JOIN "Product" AS product ON product."id" = variant."productId"
          LEFT JOIN "Category" AS category ON category."id" = product."categoryId"
          WHERE level."organizationId" = ${organization.id}
            AND level."storeId" = ${store.id}
            AND product."archivedAt" IS NULL
            ${statusCondition}
            ${searchCondition}
            ${cursorCondition}
          ORDER BY level."id" ASC
          LIMIT ${batchSize}
        `);

        if (rows.length === 0) {
          controller.close();
          return;
        }

        cursor = rows[rows.length - 1].id;
        const csvRows = rows.map((row) => {
          const available = Math.max(0, row.quantity - row.reserved);
          return [
            store.name,
            row.productName,
            row.variantName,
            row.sku,
            row.barcode ?? "",
            row.quantity,
            row.reserved,
            available,
            row.reorderPoint,
            quantityToReachReorderPoint(available, row.reorderPoint),
            row.quantity <= 0 ? "out of stock" : row.quantity <= row.reorderPoint ? "low stock" : "in stock",
          ].map(toCsvCell).join(",");
        });
        controller.enqueue(encoder.encode(`${csvRows.join("\r\n")}\r\n`));
        if (rows.length < batchSize) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inventory-${status}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
