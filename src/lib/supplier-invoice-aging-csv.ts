import { centsToDecimal, decimalToCents } from "./pos";
import { toCsvCell } from "./reporting";

export type SupplierInvoiceAgingRow = {
  supplierId: string;
  supplierName: string;
  undatedCount: number;
  undatedBalance: string;
  currentCount: number;
  currentBalance: string;
  overdue1To30Count: number;
  overdue1To30Balance: string;
  overdue31To60Count: number;
  overdue31To60Balance: string;
  overdue61PlusCount: number;
  overdue61PlusBalance: string;
};

export type SupplierInvoiceAgingDetailRow = {
  supplierName: string;
  purchaseOrderNumber: number;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  daysOverdue: number | null;
  invoiceAmount: string;
  payments: string;
  credits: string;
  balance: string;
};

export function summarizeSupplierInvoiceAging(aging: SupplierInvoiceAgingRow[]) {
  const fields = [
    ["undatedCount", "undatedBalance"],
    ["currentCount", "currentBalance"],
    ["overdue1To30Count", "overdue1To30Balance"],
    ["overdue31To60Count", "overdue31To60Balance"],
    ["overdue61PlusCount", "overdue61PlusBalance"],
  ] as const;
  const totals = {
    undatedCount: 0,
    undatedBalance: 0n,
    currentCount: 0,
    currentBalance: 0n,
    overdue1To30Count: 0,
    overdue1To30Balance: 0n,
    overdue31To60Count: 0,
    overdue31To60Balance: 0n,
    overdue61PlusCount: 0,
    overdue61PlusBalance: 0n,
  };

  for (const row of aging) {
    for (const [countField, balanceField] of fields) {
      totals[countField] += row[countField];
      totals[balanceField] += decimalToCents(row[balanceField]);
    }
  }

  return {
    undatedCount: totals.undatedCount,
    undatedBalance: centsToDecimal(totals.undatedBalance),
    currentCount: totals.currentCount,
    currentBalance: centsToDecimal(totals.currentBalance),
    overdue1To30Count: totals.overdue1To30Count,
    overdue1To30Balance: centsToDecimal(totals.overdue1To30Balance),
    overdue31To60Count: totals.overdue31To60Count,
    overdue31To60Balance: centsToDecimal(totals.overdue31To60Balance),
    overdue61PlusCount: totals.overdue61PlusCount,
    overdue61PlusBalance: centsToDecimal(totals.overdue61PlusBalance),
  };
}

export function buildSupplierInvoiceAgingCsv(
  aging: SupplierInvoiceAgingRow[],
  storeName: string,
  businessDate: string,
  currency: string,
) {
  const totals = summarizeSupplierInvoiceAging(aging);
  const rows = [
    [
      "Supplier",
      "Store",
      "As of",
      "No due date invoice count",
      "No due date balance",
      "Current invoice count",
      "Current balance",
      "1-30 days overdue invoice count",
      "1-30 days overdue balance",
      "31-60 days overdue invoice count",
      "31-60 days overdue balance",
      "61+ days overdue invoice count",
      "61+ days overdue balance",
      "Total outstanding balance",
      "Currency",
    ],
    ...aging.map((row) => [
      row.supplierName,
      storeName,
      businessDate,
      row.undatedCount,
      row.undatedBalance,
      row.currentCount,
      row.currentBalance,
      row.overdue1To30Count,
      row.overdue1To30Balance,
      row.overdue31To60Count,
      row.overdue31To60Balance,
      row.overdue61PlusCount,
      row.overdue61PlusBalance,
      centsToDecimal([
        row.undatedBalance,
        row.currentBalance,
        row.overdue1To30Balance,
        row.overdue31To60Balance,
        row.overdue61PlusBalance,
      ].reduce((total, balance) => total + decimalToCents(balance), 0n)),
      currency,
    ]),
    [
      "Total",
      storeName,
      businessDate,
      totals.undatedCount,
      totals.undatedBalance,
      totals.currentCount,
      totals.currentBalance,
      totals.overdue1To30Count,
      totals.overdue1To30Balance,
      totals.overdue31To60Count,
      totals.overdue31To60Balance,
      totals.overdue61PlusCount,
      totals.overdue61PlusBalance,
      centsToDecimal([
        totals.undatedBalance,
        totals.currentBalance,
        totals.overdue1To30Balance,
        totals.overdue31To60Balance,
        totals.overdue61PlusBalance,
      ].reduce((total, balance) => total + decimalToCents(balance), 0n)),
      currency,
    ],
  ];

  return `\uFEFF${rows.map((row) => row.map(toCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function buildSupplierInvoiceAgingDetailsCsv(
  details: SupplierInvoiceAgingDetailRow[],
  storeName: string,
  businessDate: string,
  currency: string,
) {
  const sumCents = (selectAmount: (row: SupplierInvoiceAgingDetailRow) => string) =>
    details.reduce((total, row) => total + decimalToCents(selectAmount(row)), 0n);
  const totalInvoiceAmount = centsToDecimal(sumCents((row) => row.invoiceAmount));
  const totalPayments = centsToDecimal(sumCents((row) => row.payments));
  const totalCredits = centsToDecimal(sumCents((row) => row.credits));
  const totalBalance = centsToDecimal(sumCents((row) => row.balance));
  const rows = [
    [
      "Supplier",
      "Store",
      "Purchase order",
      "Invoice number",
      "Invoice date",
      "Due date",
      "Days overdue",
      "Invoice amount",
      "Payments",
      "Supplier credits",
      "Outstanding balance",
      "As of",
      "Currency",
    ],
    ...details.map((row) => [
      row.supplierName,
      storeName,
      row.purchaseOrderNumber,
      row.invoiceNumber,
      row.invoiceDate,
      row.dueDate ?? "",
      row.daysOverdue ?? "",
      row.invoiceAmount,
      row.payments,
      row.credits,
      row.balance,
      businessDate,
      currency,
    ]),
    [
      "Total",
      storeName,
      "",
      `${details.length} invoices`,
      "",
      "",
      "",
      totalInvoiceAmount,
      totalPayments,
      totalCredits,
      totalBalance,
      businessDate,
      currency,
    ],
  ];

  return `\uFEFF${rows.map((row) => row.map(toCsvCell).join(",")).join("\r\n")}\r\n`;
}
