import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type SupplierInvoiceReminderSummary = {
  overdueCount: number;
  overdueBalance: string;
  overduePurchaseOrderIds: string[];
  dueSoonCount: number;
  dueSoonBalance: string;
  dueSoonPurchaseOrderIds: string[];
  noDueDateCount: number;
  noDueDateBalance: string;
  noDueDatePurchaseOrderIds: string[];
};

export async function getSupplierInvoiceReminderSummary(
  organizationId: string,
  storeId: string,
  businessDate: string,
): Promise<SupplierInvoiceReminderSummary> {
  const businessDateStart = new Date(`${businessDate}T00:00:00.000Z`);
  const dueSoonEnd = new Date(businessDateStart);
  dueSoonEnd.setUTCDate(dueSoonEnd.getUTCDate() + 7);
  const [summary] = await prisma.$queryRaw<SupplierInvoiceReminderSummary[]>(Prisma.sql`
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
    invoice_balances AS (
      SELECT
        invoice."purchaseOrderId",
        invoice."dueDate",
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
        AND (invoice."dueDate" IS NULL OR invoice."dueDate" < ${dueSoonEnd})
        AND invoice."amount" > COALESCE(payment.total, 0) + COALESCE(credit.total, 0)
    )
    SELECT
      COUNT(*) FILTER (WHERE "dueDate" < ${businessDateStart})::int AS "overdueCount",
      COALESCE(SUM(balance) FILTER (WHERE "dueDate" < ${businessDateStart}), 0)::text AS "overdueBalance",
      COALESCE(
        ARRAY_AGG(DISTINCT "purchaseOrderId") FILTER (WHERE "dueDate" < ${businessDateStart}),
        ARRAY[]::text[]
      ) AS "overduePurchaseOrderIds",
      COUNT(*) FILTER (WHERE "dueDate" >= ${businessDateStart})::int AS "dueSoonCount",
      COALESCE(SUM(balance) FILTER (WHERE "dueDate" >= ${businessDateStart}), 0)::text AS "dueSoonBalance",
      COALESCE(
        ARRAY_AGG(DISTINCT "purchaseOrderId") FILTER (WHERE "dueDate" >= ${businessDateStart}),
        ARRAY[]::text[]
      ) AS "dueSoonPurchaseOrderIds",
      COUNT(*) FILTER (WHERE "dueDate" IS NULL)::int AS "noDueDateCount",
      COALESCE(SUM(balance) FILTER (WHERE "dueDate" IS NULL), 0)::text AS "noDueDateBalance",
      COALESCE(
        ARRAY_AGG(DISTINCT "purchaseOrderId") FILTER (WHERE "dueDate" IS NULL),
        ARRAY[]::text[]
      ) AS "noDueDatePurchaseOrderIds"
    FROM invoice_balances
  `);

  if (!summary) {
    throw new Error("Supplier invoice reminder summary did not return a row.");
  }
  return summary;
}
