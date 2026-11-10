import { describe, expect, it } from "vitest";
import { MembershipRole } from "@prisma/client";

import { canManageSupplierInvoices } from "./permissions";
import {
  calculateSupplierInvoiceBalance,
  calculateSupplierInvoicePayableBalance,
  calculateSupplierInvoiceReconciliation,
  supplierCreditNoteRequestMatches,
  supplierInvoicePaymentRequestMatches,
  supplierInvoiceIsDueSoon,
  supplierInvoiceIsOverdue,
} from "./supplier-accounting";
import {
  supplierCreditNoteSchema,
  supplierInvoiceDueDateSchema,
  supplierInvoicePaymentSchema,
  supplierInvoiceSchema,
} from "./validation";

describe("supplier invoice balances", () => {
  it("reconciles payments and credits exactly in cents", () => {
    expect(calculateSupplierInvoiceBalance("100.00", ["40.10", "9.90"], ["20.00"])).toEqual({
      paidAmount: "50.00",
      creditedAmount: "20.00",
      balance: "30.00",
      status: "OUTSTANDING",
    });
    expect(calculateSupplierInvoiceBalance("100.00", ["75.00"], ["25.00"]).status).toBe("SETTLED");
    expect(calculateSupplierInvoiceBalance("100.00", ["75.00"], ["30.00"])).toEqual({
      paidAmount: "75.00",
      creditedAmount: "30.00",
      balance: "5.00",
      status: "CREDIT_BALANCE",
    });
  });

  it("compares aggregate invoice totals with received value exactly in cents", () => {
    expect(calculateSupplierInvoiceReconciliation(["0.10", "0.20"], ["0.03"], "0.25")).toEqual({
      invoiceTotal: "0.30",
      creditedTotal: "0.03",
      netInvoiceTotal: "0.27",
      receivedNetValue: "0.25",
      difference: "0.02",
      status: "INVOICE_HIGHER",
    });
    const receivedHigher = calculateSupplierInvoiceReconciliation(["12.00", "8.00"], [], "25.00");
    expect(receivedHigher.difference).toBe("-5.00");
    expect(receivedHigher.status).toBe("RECEIVED_HIGHER");
    const subDollarDifference = calculateSupplierInvoiceReconciliation(["0.10"], [], "0.37");
    expect(subDollarDifference.netInvoiceTotal).toBe("0.10");
    expect(subDollarDifference.difference).toBe("-0.27");
    const noActivity = calculateSupplierInvoiceReconciliation([], [], "0.00");
    expect(noActivity.difference).toBe("0.00");
    expect(noActivity.status).toBe("MATCH");
    expect(calculateSupplierInvoiceReconciliation(["10.00"], ["12.37"], "0.00").netInvoiceTotal).toBe("-2.37");
  });

  it("calculates a signed aggregate payable balance from invoices, payments, and credits", () => {
    expect(calculateSupplierInvoicePayableBalance(
      [
        { amount: "0.10", paymentAmounts: ["0.03"], creditAmounts: [] },
        { amount: "0.20", paymentAmounts: [], creditAmounts: ["0.02"] },
      ],
    )).toEqual({
      invoiceTotal: "0.30",
      paidTotal: "0.03",
      creditedTotal: "0.02",
      payableTotal: "0.25",
      creditBalanceTotal: "0.00",
    });
    const separatedBalances = calculateSupplierInvoicePayableBalance([
      { amount: "10.00", paymentAmounts: ["8.00"], creditAmounts: ["3.00"] },
      { amount: "20.00", paymentAmounts: [], creditAmounts: [] },
    ]);
    expect(separatedBalances.payableTotal).toBe("20.00");
    expect(separatedBalances.creditBalanceTotal).toBe("1.00");
    expect(calculateSupplierInvoicePayableBalance([
      { amount: "10.00", paymentAmounts: ["8.00"], creditAmounts: ["2.00"] },
    ]).payableTotal).toBe("0.00");
    expect(calculateSupplierInvoicePayableBalance([]).payableTotal).toBe("0.00");
  });

  it("accepts only matching payloads when replaying payment and credit requests", () => {
    expect(supplierInvoicePaymentRequestMatches(
      { amount: "20.50", paymentDate: "2026-11-05", method: "BANK_TRANSFER", reference: "TRX-5", note: "Paid" },
      { amount: "20.5", paymentDate: "2026-11-05", method: "BANK_TRANSFER", reference: "TRX-5", note: "Paid" },
    )).toBe(true);
    expect(supplierInvoicePaymentRequestMatches(
      { amount: "20.50", paymentDate: "2026-11-05", method: "BANK_TRANSFER", reference: "TRX-5", note: "Paid" },
      { amount: "20.50", paymentDate: "2026-11-05", method: "BANK_TRANSFER", reference: "TRX-5", note: "Different note" },
    )).toBe(false);
    expect(supplierInvoicePaymentRequestMatches(
      { amount: "20.50", paymentDate: "2026-11-05", method: "BANK_TRANSFER", reference: "TRX-5", note: "Paid" },
      { amount: "20.50", paymentDate: "2026-11-04", method: "BANK_TRANSFER", reference: "TRX-5", note: "Paid" },
    )).toBe(false);
    expect(supplierCreditNoteRequestMatches(
      { creditNoteNumber: "CN-42", amount: "10.00", issueDate: "2026-11-05", reason: "Damaged" },
      { creditNoteNumber: "CN-42", amount: "10", issueDate: "2026-11-05", reason: "Damaged" },
    )).toBe(true);
    expect(supplierCreditNoteRequestMatches(
      { creditNoteNumber: "CN-42", amount: "10.00", issueDate: "2026-11-05", reason: "Damaged" },
      { creditNoteNumber: "CN-42", amount: "10.00", issueDate: "2026-11-05", reason: "Other" },
    )).toBe(false);
    expect(supplierCreditNoteRequestMatches(
      { creditNoteNumber: "CN-42", amount: "10.00", issueDate: "2026-11-05", reason: "Damaged" },
      { creditNoteNumber: "CN-42", amount: "10.00", issueDate: "2026-11-04", reason: "Damaged" },
    )).toBe(false);
  });

  it("marks only outstanding invoices past their due date as overdue", () => {
    expect(supplierInvoiceIsOverdue("2026-11-04", "OUTSTANDING", "2026-11-05")).toBe(true);
    expect(supplierInvoiceIsOverdue("2026-11-05", "OUTSTANDING", "2026-11-05")).toBe(false);
    expect(supplierInvoiceIsOverdue("2026-11-06", "OUTSTANDING", "2026-11-05")).toBe(false);
    expect(supplierInvoiceIsOverdue(null, "OUTSTANDING", "2026-11-05")).toBe(false);
    expect(supplierInvoiceIsOverdue("2026-11-04", "SETTLED", "2026-11-05")).toBe(false);
    expect(supplierInvoiceIsOverdue("2026-11-04", "CREDIT_BALANCE", "2026-11-05")).toBe(false);
    expect(supplierInvoiceIsOverdue("invalid", "OUTSTANDING", "2026-11-05")).toBe(false);
    expect(supplierInvoiceIsOverdue("2026-99-99", "OUTSTANDING", "2026-11-05")).toBe(false);
    expect(supplierInvoiceIsOverdue("2026-11-04", "OUTSTANDING", "2026-02-30")).toBe(false);
  });

  it("marks outstanding invoices due within the next seven calendar days", () => {
    expect(supplierInvoiceIsDueSoon("2026-11-05", "OUTSTANDING", "2026-11-05", "2026-11-12")).toBe(true);
    expect(supplierInvoiceIsDueSoon("2026-11-11", "OUTSTANDING", "2026-11-05", "2026-11-12")).toBe(true);
    expect(supplierInvoiceIsDueSoon("2026-11-12", "OUTSTANDING", "2026-11-05", "2026-11-12")).toBe(false);
    expect(supplierInvoiceIsDueSoon("2026-11-04", "OUTSTANDING", "2026-11-05", "2026-11-12")).toBe(false);
    expect(supplierInvoiceIsDueSoon("2026-11-06", "SETTLED", "2026-11-05", "2026-11-12")).toBe(false);
    expect(supplierInvoiceIsDueSoon(null, "OUTSTANDING", "2026-11-05", "2026-11-12")).toBe(false);
    expect(supplierInvoiceIsDueSoon("invalid", "OUTSTANDING", "2026-11-05", "invalid")).toBe(false);
    expect(supplierInvoiceIsDueSoon("2026-11-06", "OUTSTANDING", "2026-11-05", "2026-11-04")).toBe(false);
    expect(supplierInvoiceIsDueSoon("2026-02-30", "OUTSTANDING", "2026-11-05", "2026-11-12")).toBe(false);
  });
});

describe("supplier invoice validation and permissions", () => {
  const purchaseOrderId = "clh1p2s3t0000qwertyuiopas";
  const invoiceId = "clh1p2s3t0001qwertyuiopas";
  const idempotencyKey = "123e4567-e89b-42d3-a456-426614174000";

  it("normalizes invoice numbers and validates dates and positive totals", () => {
    const result = supplierInvoiceSchema.safeParse({
      purchaseOrderId,
      invoiceNumber: " inv-2026-01 ",
      amount: "250.00",
      invoiceDate: "2026-11-01",
      dueDate: "2026-11-30",
      note: "Delivery invoice",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.invoiceNumber).toBe("INV-2026-01");
    expect(supplierInvoiceSchema.safeParse({
      purchaseOrderId,
      invoiceNumber: "INV-2",
      amount: "0",
      invoiceDate: "2026-02-31",
      dueDate: "2026-01-01",
    }).success).toBe(false);
  });

  it("requires bounded supplier payment and credit details", () => {
    expect(supplierInvoiceDueDateSchema.safeParse({
      invoiceId,
      dueDate: "2026-11-30",
    }).success).toBe(true);
    expect(supplierInvoiceDueDateSchema.safeParse({
      invoiceId,
      dueDate: "2026-02-31",
    }).success).toBe(false);
    expect(supplierInvoiceDueDateSchema.safeParse({
      invoiceId,
      dueDate: "",
    }).success).toBe(true);
    expect(supplierInvoicePaymentSchema.safeParse({
      invoiceId,
      amount: "20.50",
      paymentDate: "2026-11-05",
      method: "BANK_TRANSFER",
      reference: "TRX-5",
      note: "Paid against statement",
      idempotencyKey,
    }).success).toBe(true);
    expect(supplierInvoicePaymentSchema.safeParse({
      invoiceId,
      amount: "0",
      method: "UNKNOWN",
      idempotencyKey,
    }).success).toBe(false);
    expect(supplierInvoicePaymentSchema.safeParse({
      invoiceId,
      amount: "20.50",
      paymentDate: "2026-02-31",
      method: "BANK_TRANSFER",
      idempotencyKey,
    }).success).toBe(false);
    expect(supplierInvoicePaymentSchema.safeParse({
      invoiceId,
      amount: "20.50",
      method: "BANK_TRANSFER",
      note: "x".repeat(161),
      idempotencyKey,
    }).success).toBe(false);
    expect(supplierCreditNoteSchema.safeParse({
      invoiceId,
      creditNoteNumber: "CN-42",
      amount: "12.00",
      issueDate: "2026-11-05",
      reason: "Returned damaged goods",
      idempotencyKey,
    }).success).toBe(true);
    expect(supplierCreditNoteSchema.safeParse({
      invoiceId,
      creditNoteNumber: "CN-43",
      amount: "12.00",
      issueDate: "2026-02-31",
      reason: "Returned damaged goods",
      idempotencyKey,
    }).success).toBe(false);
    expect(supplierCreditNoteSchema.safeParse({
      invoiceId,
      creditNoteNumber: "",
      amount: "-1",
      reason: "x",
      idempotencyKey,
    }).success).toBe(false);
  });

  it("limits invoice reconciliation to owner, manager, and accountant roles", () => {
    expect(canManageSupplierInvoices(MembershipRole.OWNER)).toBe(true);
    expect(canManageSupplierInvoices(MembershipRole.MANAGER)).toBe(true);
    expect(canManageSupplierInvoices(MembershipRole.ACCOUNTANT)).toBe(true);
    expect(canManageSupplierInvoices(MembershipRole.INVENTORY_MANAGER)).toBe(false);
    expect(canManageSupplierInvoices(MembershipRole.CASHIER)).toBe(false);
  });
});
