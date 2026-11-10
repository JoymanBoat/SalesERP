import { productImportHeaders } from "@/lib/catalog";

export async function GET() {
  return new Response(`\uFEFF${productImportHeaders.map((value) => `"${value}"`).join(",")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="product-import-template.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
