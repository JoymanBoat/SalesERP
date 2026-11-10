import { canManageSupplierInvoices } from "@/lib/permissions";
import { businessDateInTimeZone } from "@/lib/pos";
import {
  buildSupplierInvoiceAgingCsv,
  buildSupplierInvoiceAgingDetailsCsv,
} from "@/lib/supplier-invoice-aging-csv";
import { getSupplierInvoiceAging, getSupplierInvoiceAgingDetails } from "@/lib/supplier-invoice-aging";
import { getWorkspace } from "@/lib/workspace";

export async function GET(request: Request) {
  const { organization, store, membership } = await getWorkspace({ feature: "reports", operation: "view" });
  if (!canManageSupplierInvoices(membership.role)) {
    return new Response("Supplier invoice aging exports are available to owners, managers, and accountants.", {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
  if (new URL(request.url).searchParams.get("detail") === "invoices") {
    const details = await getSupplierInvoiceAgingDetails(organization.id, store.id, businessDate);
    const csv = buildSupplierInvoiceAgingDetailsCsv(details, store.name, businessDate, organization.currency);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="supplier-invoice-aging-details-${businessDate}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const aging = await getSupplierInvoiceAging(organization.id, store.id, businessDate);
  const csv = buildSupplierInvoiceAgingCsv(aging, store.name, businessDate, organization.currency);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="supplier-invoice-aging-${businessDate}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
