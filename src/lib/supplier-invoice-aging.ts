import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { SupplierInvoiceAgingDetailRow, SupplierInvoiceAgingRow } from "@/lib/supplier-invoice-aging-csv";

export async function getSupplierInvoiceAging(
  organizationId: string,
  storeId: string,
  businessDate: string,
) {
  const businessDateStart = new Date(`${businessDate}T00:00:00.000Z`);
  const overdue30DaysStart = new Date(businessDateStart);
  overdue30DaysStart.setUTCDate(overdue30DaysStart.getUTCDate() - 30);
  const overdue60DaysStart = new Date(businessDateStart);
  overdue60DaysStart.setUTCDate(overdue60DaysStart.getUTCDate() - 60);

  return prisma.$queryRaw<SupplierInvoiceAgingRow[]>(Prisma.sql`
    WITH payment_totals AS (
      SELECT "supplierInvoiceId", "organizationId", "storeId", SUM("amount") AS total
      FROM "SupplierInvoicePayment"
      WHERE "organizationId" = ${organizationId} AND "storeId" = ${storeId}
      GROUP BY "supplierInvoiceId", "organizationId", "storeId"
    ),
    credit_totals AS (
      SELECT "supplierInvoiceId", "organizationId", "storeId", SUM("amount") AS total
      FROM "SupplierCreditNote"
      WHERE "organizationId" = ${organizationId} AND "storeId" = ${storeId}
      GROUP BY "supplierInvoiceId", "organizationId", "storeId"
    ),
    outstanding_invoices AS (
      SELECT invoice."supplierId", invoice."dueDate",
        invoice."amount" - COALESCE(payment.total, 0) - COALESCE(credit.total, 0) AS balance
      FROM "SupplierInvoice" AS invoice
      LEFT JOIN payment_totals AS payment
        ON payment."supplierInvoiceId" = invoice."id"
        AND payment."organizationId" = invoice."organizationId"
        AND payment."storeId" = invoice."storeId"
      LEFT JOIN credit_totals AS credit
        ON credit."supplierInvoiceId" = invoice."id"
        AND credit."organizationId" = invoice."organizationId"
        AND credit."storeId" = invoice."storeId"
      WHERE invoice."organizationId" = ${organizationId}
        AND invoice."storeId" = ${storeId}
        AND invoice."amount" > COALESCE(payment.total, 0) + COALESCE(credit.total, 0)
    )
    SELECT supplier."id" AS "supplierId",
      supplier."businessName" AS "supplierName",
      COUNT(*) FILTER (WHERE invoice."dueDate" IS NULL)::int AS "undatedCount",
      COALESCE(SUM(invoice.balance) FILTER (WHERE invoice."dueDate" IS NULL), 0)::text AS "undatedBalance",
      COUNT(*) FILTER (WHERE invoice."dueDate" >= ${businessDateStart})::int AS "currentCount",
      COALESCE(SUM(invoice.balance) FILTER (WHERE invoice."dueDate" >= ${businessDateStart}), 0)::text AS "currentBalance",
      COUNT(*) FILTER (WHERE invoice."dueDate" < ${businessDateStart} AND invoice."dueDate" >= ${overdue30DaysStart})::int AS "overdue1To30Count",
      COALESCE(SUM(invoice.balance) FILTER (WHERE invoice."dueDate" < ${businessDateStart} AND invoice."dueDate" >= ${overdue30DaysStart}), 0)::text AS "overdue1To30Balance",
      COUNT(*) FILTER (WHERE invoice."dueDate" < ${overdue30DaysStart} AND invoice."dueDate" >= ${overdue60DaysStart})::int AS "overdue31To60Count",
      COALESCE(SUM(invoice.balance) FILTER (WHERE invoice."dueDate" < ${overdue30DaysStart} AND invoice."dueDate" >= ${overdue60DaysStart}), 0)::text AS "overdue31To60Balance",
      COUNT(*) FILTER (WHERE invoice."dueDate" < ${overdue60DaysStart})::int AS "overdue61PlusCount",
      COALESCE(SUM(invoice.balance) FILTER (WHERE invoice."dueDate" < ${overdue60DaysStart}), 0)::text AS "overdue61PlusBalance"
    FROM outstanding_invoices AS invoice
    INNER JOIN "Supplier" AS supplier
      ON supplier."id" = invoice."supplierId"
      AND supplier."organizationId" = ${organizationId}
    GROUP BY supplier."id", supplier."businessName"
    ORDER BY SUM(invoice.balance) DESC, supplier."businessName" ASC
  `);
}

export async function getSupplierInvoiceAgingDetails(
  organizationId: string,
  storeId: string,
  businessDate: string,
) {
  const businessDateStart = new Date(`${businessDate}T00:00:00.000Z`);

  return prisma.$queryRaw<SupplierInvoiceAgingDetailRow[]>(Prisma.sql`
    WITH payment_totals AS (
      SELECT "supplierInvoiceId", "organizationId", "storeId", SUM("amount") AS total
      FROM "SupplierInvoicePayment"
      WHERE "organizationId" = ${organizationId} AND "storeId" = ${storeId}
      GROUP BY "supplierInvoiceId", "organizationId", "storeId"
    ),
    credit_totals AS (
      SELECT "supplierInvoiceId", "organizationId", "storeId", SUM("amount") AS total
      FROM "SupplierCreditNote"
      WHERE "organizationId" = ${organizationId} AND "storeId" = ${storeId}
      GROUP BY "supplierInvoiceId", "organizationId", "storeId"
    )
    SELECT supplier."businessName" AS "supplierName",
      purchase_order."number" AS "purchaseOrderNumber",
      invoice."invoiceNumber",
      to_char(invoice."invoiceDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "invoiceDate",
      to_char(invoice."dueDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "dueDate",
      CASE
        WHEN invoice."dueDate" IS NULL THEN NULL
        ELSE GREATEST((${businessDateStart}::date - invoice."dueDate"::date), 0)::int
      END AS "daysOverdue",
      invoice."amount"::text AS "invoiceAmount",
      COALESCE(payment.total, 0)::text AS payments,
      COALESCE(credit.total, 0)::text AS credits,
      (invoice."amount" - COALESCE(payment.total, 0) - COALESCE(credit.total, 0))::text AS balance
    FROM "SupplierInvoice" AS invoice
    INNER JOIN "Supplier" AS supplier
      ON supplier."id" = invoice."supplierId"
      AND supplier."organizationId" = invoice."organizationId"
    INNER JOIN "PurchaseOrder" AS purchase_order
      ON purchase_order."id" = invoice."purchaseOrderId"
      AND purchase_order."organizationId" = invoice."organizationId"
      AND purchase_order."storeId" = invoice."storeId"
    LEFT JOIN payment_totals AS payment
      ON payment."supplierInvoiceId" = invoice."id"
      AND payment."organizationId" = invoice."organizationId"
      AND payment."storeId" = invoice."storeId"
    LEFT JOIN credit_totals AS credit
      ON credit."supplierInvoiceId" = invoice."id"
      AND credit."organizationId" = invoice."organizationId"
      AND credit."storeId" = invoice."storeId"
    WHERE invoice."organizationId" = ${organizationId}
      AND invoice."storeId" = ${storeId}
      AND invoice."amount" > COALESCE(payment.total, 0) + COALESCE(credit.total, 0)
    ORDER BY invoice."dueDate" ASC NULLS LAST, supplier."businessName" ASC, purchase_order."number" ASC, invoice."invoiceNumber" ASC
  `);
}
