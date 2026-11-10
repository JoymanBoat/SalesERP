import { buildSalesTrendQuery, parseReportPeriod, toCsvCell, type SalesTrendBucket } from "@/lib/reporting";
import { getWorkspace } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { organization, store } = await getWorkspace({ feature: "reports", operation: "view" });
  const searchParams = new URL(request.url).searchParams;
  const days = parseReportPeriod(searchParams.get("days") ?? undefined);
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const trend = await prisma.$queryRaw<SalesTrendBucket[]>(buildSalesTrendQuery({
    organizationId: organization.id,
    storeId: store.id,
    timezone: organization.timezone,
    since,
    now,
    days,
  }));
  const rows = [
    ["Period", `Net sales (${organization.currency})`, "Paid orders"],
    ...trend.map((item) => [item.period, item.revenue.toString(), item.orderCount.toString()]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(toCsvCell).join(",")).join("\r\n")}\r\n`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-trend-${days}-days.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
