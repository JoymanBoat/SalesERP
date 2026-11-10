import type { Prisma } from "@prisma/client";

import { productInputSchema } from "./validation";

export class CatalogCsvError extends Error {}

export const productImportHeaders = [
  "Product name",
  "SKU",
  "Barcode",
  "Category",
  "Unit price",
  "Cost price",
  "Opening stock",
  "Reorder point",
] as const;

export function parseCatalogCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteClosed = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0 || quoteClosed) throw new CatalogCsvError("Unexpected quote in CSV data.");
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
      quoteClosed = false;
    } else if (character === "\r" || character === "\n") {
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
      quoteClosed = false;
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      if (quoteClosed) throw new CatalogCsvError("Unexpected data after a quoted CSV field.");
      field += character;
    }
  }

  if (inQuotes) throw new CatalogCsvError("A quoted CSV field was not closed.");
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

export function parseProductImportCsv(text: string) {
  const rows = parseCatalogCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new CatalogCsvError("The CSV must include a header and at least one product row.");
  if (rows.length > 51) throw new CatalogCsvError("Import up to 50 products at a time.");

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new CatalogCsvError("The CSV contains duplicate column names.");
  const requiredHeaders = ["product name", "sku", "unit price", "opening stock", "reorder point"];
  const supportedHeaders = new Set([...requiredHeaders, "barcode", "category", "cost price"]);
  const missingHeader = requiredHeaders.find((header) => !headers.includes(header));
  if (missingHeader) {
    throw new CatalogCsvError(`The CSV is missing the required “${missingHeader}” column. Download the template for the supported format.`);
  }
  const unsupportedHeader = headers.find((header) => !supportedHeaders.has(header));
  if (unsupportedHeader) throw new CatalogCsvError(`The “${unsupportedHeader}” column is not supported by the import template.`);

  const column = (name: string) => headers.indexOf(name);
  const products: Array<ReturnType<typeof productInputSchema.parse>> = [];
  const seenSkus = new Set<string>();
  for (const [index, row] of rows.slice(1).entries()) {
    if (row.length !== headers.length) {
      throw new CatalogCsvError(`Row ${index + 2} has ${row.length} values; expected ${headers.length}.`);
    }
    const parsed = productInputSchema.safeParse({
      name: row[column("product name")],
      sku: row[column("sku")],
      barcode: column("barcode") >= 0 ? row[column("barcode")] : undefined,
      category: column("category") >= 0 ? row[column("category")] : undefined,
      unitPrice: row[column("unit price")],
      costPrice: column("cost price") >= 0 ? row[column("cost price")] : "",
      initialStock: row[column("opening stock")],
      reorderPoint: row[column("reorder point")],
    });
    if (!parsed.success) {
      throw new CatalogCsvError(`Row ${index + 2}: ${parsed.error.issues[0]?.message ?? "Check the product values."}`);
    }
    const skuKey = parsed.data.sku;
    if (seenSkus.has(skuKey)) throw new CatalogCsvError(`Row ${index + 2}: SKU “${parsed.data.sku}” appears more than once in this file.`);
    seenSkus.add(skuKey);
    products.push(parsed.data);
  }
  return products;
}

export function buildProductWhere(query: string, showArchived: boolean): Prisma.ProductWhereInput {
  return {
    archivedAt: showArchived ? { not: null } : null,
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { category: { name: { contains: query, mode: "insensitive" } } },
            {
              variants: {
                some: {
                  OR: [
                    { sku: { contains: query, mode: "insensitive" } },
                    { barcode: { contains: query, mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
}
