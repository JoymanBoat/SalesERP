import { centsToDecimal, decimalToCents } from "./pos";
import { isCalendarDate } from "./calendar-date";

export type SupplierInvoiceBalance = {
  paidAmount: string;
  creditedAmount: string;
  balance: string;
  status: "OUTSTANDING" | "SETTLED" | "CREDIT_BALANCE";
};

export function supplierInvoicePaymentRequestMatches(
  prior: { amount: string; paymentDate: string; method: string; reference: string | null; note: string | null },
  requested: { amount: string; paymentDate?: string; method: string; reference?: string; note?: string },
) {
  return decimalToCents(prior.amount) === decimalToCents(requested.amount)
    && prior.paymentDate === (requested.paymentDate || "")
    && prior.method === requested.method
    && prior.reference === (requested.reference || null)
    && prior.note === (requested.note || null);
}

export function supplierCreditNoteRequestMatches(
  prior: { creditNoteNumber: string; amount: string; issueDate: string; reason: string },
  requested: { creditNoteNumber: string; amount: string; issueDate?: string; reason: string },
) {
  return prior.creditNoteNumber === requested.creditNoteNumber
    && decimalToCents(prior.amount) === decimalToCents(requested.amount)
    && prior.issueDate === (requested.issueDate || "")
    && prior.reason === requested.reason;
}

export function supplierInvoiceIsOverdue(
  dueDate: string | null,
  balanceStatus: SupplierInvoiceBalance["status"],
  businessDate: string,
) {
  if (
    balanceStatus !== "OUTSTANDING" ||
    !dueDate ||
    !isCalendarDate(dueDate) ||
    !isCalendarDate(businessDate)
  ) {
    return false;
  }
  return dueDate < businessDate;
}

export function supplierInvoiceIsDueSoon(
  dueDate: string | null,
  balanceStatus: SupplierInvoiceBalance["status"],
  businessDate: string,
  dueSoonEndDate: string,
) {
  if (
    balanceStatus !== "OUTSTANDING" ||
    !dueDate ||
    !isCalendarDate(dueDate) ||
    !isCalendarDate(businessDate) ||
    !isCalendarDate(dueSoonEndDate) ||
    dueSoonEndDate < businessDate
  ) {
    return false;
  }
  return dueDate >= businessDate && dueDate < dueSoonEndDate;
}

export function calculateSupplierInvoiceBalance(
  invoiceAmount: string,
  paymentAmounts: string[],
  creditAmounts: string[],
): SupplierInvoiceBalance {
  const invoiceCents = decimalToCents(invoiceAmount);
  const paidCents = paymentAmounts.reduce((total, amount) => total + decimalToCents(amount), 0n);
  const creditedCents = creditAmounts.reduce((total, amount) => total + decimalToCents(amount), 0n);
  const balanceCents = invoiceCents - paidCents - creditedCents;

  return {
    paidAmount: centsToDecimal(paidCents),
    creditedAmount: centsToDecimal(creditedCents),
    balance: centsToDecimal(balanceCents < 0n ? -balanceCents : balanceCents),
    status: balanceCents < 0n ? "CREDIT_BALANCE" : balanceCents === 0n ? "SETTLED" : "OUTSTANDING",
  };
}

export function calculateSupplierInvoiceReconciliation(
  invoiceAmounts: string[],
  creditAmounts: string[],
  receivedNetValue: string,
) {
  const invoiceTotalCents = invoiceAmounts.reduce(
    (total, amount) => total + decimalToCents(amount),
    0n,
  );
  const creditedTotalCents = creditAmounts.reduce(
    (total, amount) => total + decimalToCents(amount),
    0n,
  );
  const netInvoiceTotalCents = invoiceTotalCents - creditedTotalCents;
  const receivedNetValueCents = decimalToCents(receivedNetValue);

  return {
    invoiceTotal: centsToDecimal(invoiceTotalCents),
    creditedTotal: centsToDecimal(creditedTotalCents),
    netInvoiceTotal: centsToDecimal(netInvoiceTotalCents),
    receivedNetValue: centsToDecimal(receivedNetValueCents),
    difference: centsToDecimal(netInvoiceTotalCents - receivedNetValueCents),
    status: netInvoiceTotalCents === receivedNetValueCents
      ? "MATCH"
      : netInvoiceTotalCents > receivedNetValueCents
        ? "INVOICE_HIGHER"
        : "RECEIVED_HIGHER",
  };
}

export function calculateSupplierInvoicePayableBalance(
  invoices: Array<{
    amount: string;
    paymentAmounts: string[];
    creditAmounts: string[];
  }>,
) {
  const totals = invoices.reduce((current, invoice) => {
    const invoiceCents = decimalToCents(invoice.amount);
    const paidCents = invoice.paymentAmounts.reduce(
      (total, amount) => total + decimalToCents(amount),
      0n,
    );
    const creditedCents = invoice.creditAmounts.reduce(
      (total, amount) => total + decimalToCents(amount),
      0n,
    );
    const balanceCents = invoiceCents - paidCents - creditedCents;

    return {
      invoiceTotal: current.invoiceTotal + invoiceCents,
      paidTotal: current.paidTotal + paidCents,
      creditedTotal: current.creditedTotal + creditedCents,
      payableTotal: current.payableTotal + (balanceCents > 0n ? balanceCents : 0n),
      creditBalanceTotal: current.creditBalanceTotal + (balanceCents < 0n ? -balanceCents : 0n),
    };
  }, {
    invoiceTotal: 0n,
    paidTotal: 0n,
    creditedTotal: 0n,
    payableTotal: 0n,
    creditBalanceTotal: 0n,
  });
  return {
    invoiceTotal: centsToDecimal(totals.invoiceTotal),
    paidTotal: centsToDecimal(totals.paidTotal),
    creditedTotal: centsToDecimal(totals.creditedTotal),
    payableTotal: centsToDecimal(totals.payableTotal),
    creditBalanceTotal: centsToDecimal(totals.creditBalanceTotal),
  };
}
