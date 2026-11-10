"use client";

import { useActionState, useEffect, useState } from "react";

import {
  recordSupplierCreditNote,
  recordSupplierInvoice,
  recordSupplierInvoicePayment,
  updateSupplierInvoiceDueDate,
} from "@/app/purchasing/actions";
import {
  calculateSupplierInvoiceBalance,
  calculateSupplierInvoicePayableBalance,
  calculateSupplierInvoiceReconciliation,
  supplierInvoiceIsDueSoon,
  supplierInvoiceIsOverdue,
} from "@/lib/supplier-accounting";

const initialState = { status: "idle" as const, message: "" };

type SupplierInvoiceRecord = {
  id: string;
  invoiceNumber: string;
  amount: string;
  invoiceDate: string;
  invoiceDateKey: string;
  dueDate: string | null;
  dueDateKey: string | null;
  note: string | null;
  createdBy: string | null;
  recordedAt: string;
  payments: Array<{
    id: string;
    amount: string;
    method: string;
    reference: string | null;
    note: string | null;
    createdBy: string | null;
    paidAt: string;
    recordedAt: number;
  }>;
  creditNotes: Array<{
    id: string;
    creditNoteNumber: string;
    amount: string;
    reason: string;
    createdBy: string | null;
    issuedAt: string;
    recordedAt: number;
  }>;
};

function money(value: number, currency: string) {
  return `${currency} ${value.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SupplierPaymentForm({
  invoice,
  currency,
  businessDate,
}: {
  invoice: SupplierInvoiceRecord;
  currency: string;
  businessDate: string;
}) {
  const [state, action, pending] = useActionState(recordSupplierInvoicePayment, initialState);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, [state]);

  const balance = calculateSupplierInvoiceBalance(
    invoice.amount,
    invoice.payments.map((payment) => payment.amount),
    invoice.creditNotes.map((credit) => credit.amount),
  );

  if (balance.status !== "OUTSTANDING") return null;

  return (
    <form action={action} className="supplier-invoice-entry-form">
      <input type="hidden" name="invoiceId" value={invoice.id} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <label>Payment amount · balance {money(Number(balance.balance), currency)}
        <input name="amount" type="number" min="0.01" max={balance.balance} step="0.01" required />
      </label>
      <label>Payment date
        <input name="paymentDate" type="date" max={businessDate} defaultValue={businessDate} required />
      </label>
      <label>Method
        <select name="method" defaultValue="BANK_TRANSFER">
          <option value="BANK_TRANSFER">Bank transfer</option>
          <option value="MOBILE_MONEY">Mobile money</option>
          <option value="CASH">Cash</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <label>Reference <span className="optional-label">Optional</span>
        <input name="reference" type="text" maxLength={100} placeholder="Transfer or receipt reference" />
      </label>
      <label>Payment note <span className="optional-label">Optional</span>
        <input name="note" type="text" maxLength={160} placeholder="Short internal note" />
      </label>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
      <button className="button-quiet" type="submit" disabled={pending || !idempotencyKey}>{pending ? "Recording..." : "Record payment"}</button>
    </form>
  );
}

function SupplierCreditNoteForm({ invoiceId, businessDate }: { invoiceId: string; businessDate: string }) {
  const [state, action, pending] = useActionState(recordSupplierCreditNote, initialState);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, [state]);

  return (
    <form action={action} className="supplier-invoice-entry-form">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <label>Credit-note number
        <input name="creditNoteNumber" type="text" minLength={1} maxLength={80} required />
      </label>
      <label>Credit amount
        <input name="amount" type="number" min="0.01" max="999999999.99" step="0.01" required />
      </label>
      <label>Issue date
        <input name="issueDate" type="date" max={businessDate} defaultValue={businessDate} required />
      </label>
      <label>Reason
        <input name="reason" type="text" minLength={3} maxLength={160} placeholder="Supplier-issued credit reason" required />
      </label>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
      <button className="button-quiet" type="submit" disabled={pending || !idempotencyKey}>{pending ? "Recording..." : "Record credit note"}</button>
    </form>
  );
}

function SupplierInvoiceDueDateForm({ invoice }: { invoice: SupplierInvoiceRecord }) {
  const [state, action, pending] = useActionState(updateSupplierInvoiceDueDate, initialState);

  return (
    <form action={action} className="supplier-invoice-entry-form">
      <input type="hidden" name="invoiceId" value={invoice.id} />
      <label>Due date
        <input name="dueDate" type="date" min={invoice.invoiceDateKey} defaultValue={invoice.dueDateKey ?? ""} />
      </label>
      <span className="optional-label">Leave blank to remove the due date.</span>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
      <button className="button-quiet" type="submit" disabled={pending}>
        {pending ? "Updating..." : invoice.dueDate ? "Update due date" : "Add due date"}
      </button>
    </form>
  );
}

export function SupplierInvoicePanel({
  purchaseOrderId,
  purchaseOrderStatus,
  currency,
  receivedNetValue,
  businessDate,
  dueSoonEndDate,
  invoices,
  canManageInvoices,
}: {
  purchaseOrderId: string;
  purchaseOrderStatus: string;
  currency: string;
  receivedNetValue: string;
  businessDate: string;
  dueSoonEndDate: string;
  invoices: SupplierInvoiceRecord[];
  canManageInvoices: boolean;
}) {
  const [state, action, pending] = useActionState(recordSupplierInvoice, initialState);
  const reconciliation = calculateSupplierInvoiceReconciliation(
    invoices.map((invoice) => invoice.amount),
    invoices.flatMap((invoice) => invoice.creditNotes.map((credit) => credit.amount)),
    receivedNetValue,
  );
  const payableBalance = calculateSupplierInvoicePayableBalance(
    invoices.map((invoice) => ({
      amount: invoice.amount,
      paymentAmounts: invoice.payments.map((payment) => payment.amount),
      creditAmounts: invoice.creditNotes.map((credit) => credit.amount),
    })),
  );

  return (
    <section className="supplier-invoice-panel" aria-label="Supplier invoice reconciliation">
      <div className="supplier-invoice-panel-heading">
        <strong>Invoice reconciliation</strong>
        <span>Received value less returns at purchase cost: {money(Number(reconciliation.receivedNetValue), currency)}</span>
        {invoices.length > 0 && (
          <>
            <span>Recorded invoice total: {money(Number(reconciliation.invoiceTotal), currency)} · Supplier credits: −{money(Number(reconciliation.creditedTotal), currency)}</span>
            <span>
              {reconciliation.status === "MATCH"
                ? "Net invoiced matches received net value."
                : reconciliation.status === "INVOICE_HIGHER"
                  ? `Net invoiced exceeds received net value by ${money(Number(reconciliation.difference), currency)}.`
                  : `Received net value exceeds net invoiced by ${money(-Number(reconciliation.difference), currency)}.`}
              {" "}Net invoiced: {money(Number(reconciliation.netInvoiceTotal), currency)}.
            </span>
            <span>
              Invoice total {money(Number(payableBalance.invoiceTotal), currency)} · Payments −{money(Number(payableBalance.paidTotal), currency)} · Credits −{money(Number(payableBalance.creditedTotal), currency)}
            </span>
            <span>
              Outstanding across invoices: {money(Number(payableBalance.payableTotal), currency)} · Credit balances: {money(Number(payableBalance.creditBalanceTotal), currency)}.
            </span>
          </>
        )}
      </div>
      {invoices.map((invoice) => {
        const totals = calculateSupplierInvoiceBalance(
          invoice.amount,
          invoice.payments.map((payment) => payment.amount),
          invoice.creditNotes.map((credit) => credit.amount),
        );
        const overdue = supplierInvoiceIsOverdue(invoice.dueDateKey, totals.status, businessDate);
        const dueSoon = supplierInvoiceIsDueSoon(invoice.dueDateKey, totals.status, businessDate, dueSoonEndDate);
        const missingDueDate = totals.status === "OUTSTANDING" && !invoice.dueDateKey;
        const status = totals.status === "CREDIT_BALANCE" ? "Supplier credit" : totals.status === "SETTLED" ? "Settled" : "Outstanding";
        const history = [
          ...invoice.payments.map((payment) => ({ ...payment, kind: "payment" as const })),
          ...invoice.creditNotes.map((credit) => ({ ...credit, kind: "credit" as const })),
        ].sort((first, second) => second.recordedAt - first.recordedAt || second.id.localeCompare(first.id));

        return (
          <article className="supplier-invoice-card" key={invoice.id}>
            <header>
              <div><strong>Invoice {invoice.invoiceNumber}</strong><span>Issued {invoice.invoiceDate}{invoice.dueDate ? ` · Due ${invoice.dueDate}` : ""}</span></div>
              <div>
                <span className={`order-status ${overdue ? "order-status-overdue" : missingDueDate ? "order-status-missing-date" : totals.status !== "OUTSTANDING" ? "order-status-received" : "order-status-ordered"}`}>
                  {overdue ? "Past due" : dueSoon ? "Due soon" : missingDueDate ? "Missing due date" : status}
                </span>
                <strong>{currency} {Number(invoice.amount).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </div>
            </header>
            <p className="supplier-invoice-recorded">
              Recorded {invoice.recordedAt}{invoice.createdBy ? ` by ${invoice.createdBy}` : ""}
            </p>
            {invoice.note && <p className="purchase-order-notes">{invoice.note}</p>}
            <dl className="supplier-invoice-totals">
              <div><dt>Invoice total</dt><dd>{money(Number(invoice.amount), currency)}</dd></div>
              <div><dt>Payments</dt><dd>−{money(Number(totals.paidAmount), currency)}</dd></div>
              <div><dt>Supplier credits</dt><dd>−{money(Number(totals.creditedAmount), currency)}</dd></div>
              <div className={totals.status === "CREDIT_BALANCE" ? "supplier-credit-balance" : ""}><dt>{totals.status === "CREDIT_BALANCE" ? "Credit balance" : "Balance due"}</dt><dd>{money(Number(totals.balance), currency)}</dd></div>
            </dl>
            {(invoice.payments.length > 0 || invoice.creditNotes.length > 0) && (
              <details className="supplier-invoice-history">
                <summary>Payment and credit history ({invoice.payments.length + invoice.creditNotes.length})</summary>
                {history.map((entry) => (
                  <p key={entry.id}>
                        {entry.kind === "payment"
                      ? `Payment · ${entry.paidAt} · ${entry.method.replaceAll("_", " ")} · ${money(Number(entry.amount), currency)}${entry.reference ? ` · ${entry.reference}` : ""}${entry.note ? ` · ${entry.note}` : ""}${entry.createdBy ? ` · Recorded by ${entry.createdBy}` : ""}`
                      : `Credit ${entry.creditNoteNumber} · ${entry.issuedAt} · ${money(Number(entry.amount), currency)} · ${entry.reason}${entry.createdBy ? ` · Recorded by ${entry.createdBy}` : ""}`}
                  </p>
                ))}
              </details>
            )}
            {canManageInvoices && (
              <div className="supplier-invoice-entries">
                {totals.status === "OUTSTANDING" && <SupplierInvoiceDueDateForm invoice={invoice} />}
                <SupplierPaymentForm invoice={invoice} currency={currency} businessDate={businessDate} />
                <SupplierCreditNoteForm invoiceId={invoice.id} businessDate={businessDate} />
              </div>
            )}
          </article>
        );
      })}
      {canManageInvoices && purchaseOrderStatus !== "CANCELLED" && (
        <details className="supplier-invoice-create">
          <summary>Record supplier invoice</summary>
          <form action={action} className="supplier-invoice-entry-form">
            <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
            <label>Invoice number
              <input name="invoiceNumber" type="text" minLength={1} maxLength={80} required />
            </label>
            <label>Invoice amount · {currency}
              <input name="amount" type="number" min="0.01" max="999999999.99" step="0.01" required />
            </label>
            <label>Invoice date
              <input name="invoiceDate" type="date" defaultValue={businessDate} required />
            </label>
            <label>Due date <span className="optional-label">Optional</span>
              <input name="dueDate" type="date" />
            </label>
            <label>Note <span className="optional-label">Optional</span>
              <input name="note" type="text" maxLength={240} />
            </label>
            {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
            <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Recording..." : "Record invoice"}</button>
          </form>
        </details>
      )}
      {!canManageInvoices && invoices.length === 0 && <p className="permission-note">No supplier invoices recorded. Your role can view but not record invoices, payments, or credits.</p>}
    </section>
  );
}
