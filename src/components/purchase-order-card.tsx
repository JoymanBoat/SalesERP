"use client";

import { useActionState, useEffect, useState } from "react";

import { cancelPurchaseOrder, receivePurchaseOrder, recordSupplierFollowUp, returnSupplierGoods } from "@/app/purchasing/actions";
import { SupplierInvoicePanel } from "@/components/supplier-invoice-panel";

const initialState = { status: "idle" as const, message: "" };

type PurchaseOrderLine = {
  id: string;
  productName: string;
  sku: string;
  orderedQuantity: number;
  receivedQuantity: number;
  returnedQuantity: number;
  unitCost: string;
};

type SupplierReturn = {
  id: string;
  reason: string;
  createdAt: string;
  createdBy: string;
  recordedValue: string;
  items: Array<{
    productName: string;
    sku: string;
    quantity: number;
    unitCost: string;
  }>;
};

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

type SupplierFollowUpRecord = {
  id: string;
  method: string;
  summary: string;
  contactedAt: string;
  followUpAt: string | null;
  createdBy: string;
};

function SupplierFollowUpForm({ purchaseOrderId }: { purchaseOrderId: string }) {
  const [state, action, pending] = useActionState(recordSupplierFollowUp, initialState);

  return (
    <form action={action} className="supplier-followup-form">
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
      <label>Contact method
        <select name="method" defaultValue="PHONE" required>
          <option value="PHONE">Phone</option>
          <option value="EMAIL">Email</option>
          <option value="IN_PERSON">In person</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <label>Contact summary
        <input name="summary" minLength={3} maxLength={500} required placeholder="e.g. Supplier confirmed delivery next week" />
      </label>
      <label>Next follow-up <span className="optional-label">Optional</span>
        <input name="followUpAt" type="date" />
      </label>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
      <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Recording..." : "Record contact"}</button>
    </form>
  );
}

function SupplierReturnForm({
  purchaseOrderId,
  item,
}: {
  purchaseOrderId: string;
  item: PurchaseOrderLine;
}) {
  const [state, action, pending] = useActionState(returnSupplierGoods, initialState);
  const returnable = item.receivedQuantity - item.returnedQuantity;

  if (returnable < 1) return null;

  return (
    <form action={action} className="purchase-return-form">
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
      <input type="hidden" name="itemId" value={item.id} />
      <label>
        Return {item.productName} (up to {returnable})
        <input name="quantity" type="number" min="1" max={returnable} step="1" required />
      </label>
      <label>
        Reason
        <input name="reason" type="text" minLength={3} maxLength={160} placeholder="e.g. Damaged on delivery" required />
      </label>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
      <button className="button-quiet" type="submit" disabled={pending}>
        {pending ? "Recording..." : "Return to supplier"}
      </button>
    </form>
  );
}

export function PurchaseOrderCard({
  order,
  businessDate,
  dueSoonEndDate,
  organizationName,
  currency,
  canReceive,
  canManageInvoices,
}: {
  order: {
    id: string;
    number: number;
    status: string;
    overdue: boolean;
    followUpDue: boolean;
    nextFollowUpAt: string | null;
    subtotal: string;
    supplierName: string;
    storeName: string;
    createdAt: string;
    expectedAt: string | null;
    notes: string | null;
    items: PurchaseOrderLine[];
    followUps: SupplierFollowUpRecord[];
    returns: SupplierReturn[];
    receivedNetValue: string;
    invoices: SupplierInvoiceRecord[];
  };
  businessDate: string;
  dueSoonEndDate: string;
  organizationName: string;
  currency: string;
  canReceive: boolean;
  canManageInvoices: boolean;
}) {
  const [state, action, pending] = useActionState(receivePurchaseOrder, initialState);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelPurchaseOrder, initialState);
  const [printing, setPrinting] = useState(false);
  const [quantities, setQuantities] = useState(order.items.map((item) => item.orderedQuantity - item.receivedQuantity));
  const receivable = canReceive && ["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status);
  const cancellable = canReceive && order.status === "ORDERED" && order.items.every((item) => item.receivedQuantity === 0);

  useEffect(() => {
    if (!printing) return;
    const finishPrinting = () => setPrinting(false);
    window.addEventListener("afterprint", finishPrinting, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", finishPrinting);
  }, [printing]);

  return (
    <article className={`purchase-order-card${printing ? " is-printing" : ""}`}>
      <header className="purchase-order-header">
        <div>
          <strong>PO #{order.number} · {order.supplierName}</strong>
          <span>{order.storeName} · Placed {order.createdAt}{order.expectedAt ? ` · Due ${order.expectedAt}` : ""}</span>
        </div>
        <div className="purchase-order-total">
          <span className={`order-status order-status-${order.overdue ? "overdue" : order.status.toLowerCase()}`}>{order.overdue ? "Overdue" : order.status.replaceAll("_", " ")}</span>
          <strong>{currency} {Number(order.subtotal).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          <button className="button-quiet purchase-order-print-button" type="button" onClick={() => setPrinting(true)}>Print purchase order</button>
        </div>
      </header>
      <section className="purchase-order-print" aria-label={`Printable purchase order ${order.number}`}>
        <p className="purchase-order-print-organization">{organizationName}</p>
        <p className="eyebrow">Purchase order</p>
        <h1>PO #{order.number}</h1>
        <div className="purchase-order-print-meta">
          <div><span>Supplier</span><strong>{order.supplierName}</strong></div>
          <div><span>Ship to</span><strong>{order.storeName}</strong></div>
          <div><span>Order date</span><strong>{order.createdAt}</strong></div>
          <div><span>Expected delivery</span><strong>{order.expectedAt ?? "Not specified"}</strong></div>
        </div>
        <table className="purchase-order-print-table">
          <thead><tr><th>Item</th><th>SKU</th><th>Quantity</th><th>Unit cost</th><th>Line total</th></tr></thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td>{item.productName}</td>
                <td>{item.sku}</td>
                <td>{item.orderedQuantity}</td>
                <td>{currency} {Number(item.unitCost).toFixed(2)}</td>
                <td>{currency} {(item.orderedQuantity * Number(item.unitCost)).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th colSpan={4}>Order subtotal</th><th>{currency} {Number(order.subtotal).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</th></tr></tfoot>
        </table>
        {order.notes && <p className="purchase-order-print-notes"><strong>Notes:</strong> {order.notes}</p>}
        <p className="purchase-order-print-footer">This document is a purchase order, not a tax invoice or proof of payment.</p>
      </section>
      {order.notes && <p className="purchase-order-notes">{order.notes}</p>}
      {(order.overdue || order.followUpDue || order.followUps.length > 0) && (
        <section className="supplier-followups" aria-label={`Supplier follow-ups for purchase order ${order.number}`}>
          <div className="supplier-followups-heading">
            <strong>Supplier follow-up</strong>
            {order.followUpDue
              ? <span>Follow-up due{order.nextFollowUpAt ? ` · ${order.nextFollowUpAt}` : ""}</span>
              : order.overdue && <span>Order overdue · expected {order.expectedAt}</span>}
          </div>
          {(order.overdue || order.followUpDue) && canReceive && <SupplierFollowUpForm purchaseOrderId={order.id} />}
          {order.followUps.length > 0 && (
            <ol className="supplier-followup-history">
              {order.followUps.map((followUp) => (
                <li key={followUp.id}>
                  <strong>{followUp.contactedAt} · {followUp.method.replaceAll("_", " ")} · {followUp.createdBy}</strong>
                  <span>{followUp.summary}</span>
                  {followUp.followUpAt && <small>Next follow-up: {followUp.followUpAt}</small>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      <div className="purchase-order-lines">
        {receivable ? (
          <form action={action} className="purchase-receive-form">
          <input type="hidden" name="purchaseOrderId" value={order.id} />
          <input type="hidden" name="lines" value={JSON.stringify(order.items.map((item, index) => ({ itemId: item.id, quantity: quantities[index] ?? 0 })))} />
          {order.items.map((item, index) => {
            const outstanding = item.orderedQuantity - item.receivedQuantity;
            return (
              <div className="purchase-order-item" key={item.id}>
                <span><strong>{item.productName}</strong><small>{item.sku} · {item.receivedQuantity}/{item.orderedQuantity} received · {item.returnedQuantity} returned · {currency} {Number(item.unitCost).toFixed(2)} each</small></span>
                <label>Receive
                  <input
                    aria-label={`Receive ${item.productName}`}
                    type="number"
                    min="0"
                    max={outstanding}
                    step="1"
                    value={quantities[index] ?? 0}
                    onChange={(event) => setQuantities((current) => current.map((quantity, lineIndex) => lineIndex === index ? Number(event.target.value) : quantity))}
                  />
                </label>
              </div>
            );
          })}
          {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
          <button className="button-quiet purchase-receive-button" type="submit" disabled={pending}>
            {pending ? "Recording receipt..." : "Receive entered quantities"}
          </button>
          </form>
        ) : order.items.map((item) => (
          <div className="purchase-order-item" key={item.id}>
            <span><strong>{item.productName}</strong><small>{item.sku} · {item.receivedQuantity}/{item.orderedQuantity} received · {item.returnedQuantity} returned · {currency} {Number(item.unitCost).toFixed(2)} each</small></span>
          </div>
        ))}
      </div>
      {canReceive && order.items.some((item) => item.receivedQuantity > item.returnedQuantity) && (
        <section className="purchase-returns" aria-label={`Returns for purchase order ${order.number}`}>
          <strong>Return received goods</strong>
          {order.items.map((item) => (
            <SupplierReturnForm key={item.id} purchaseOrderId={order.id} item={item} />
          ))}
        </section>
      )}
      {order.returns.length > 0 && (
        <details className="purchase-return-history">
          <summary>Return history ({order.returns.length})</summary>
          <div className="purchase-return-history-list">
            {order.returns.map((supplierReturn) => (
              <article key={supplierReturn.id}>
                <strong>{supplierReturn.createdAt} · {supplierReturn.createdBy}</strong>
                <span>{supplierReturn.items.map((item) => `${item.productName} (${item.sku}) × ${item.quantity}`).join(", ")}</span>
                <span>{supplierReturn.reason}</span>
                <small>Returned value at purchase cost: {currency} {Number(supplierReturn.recordedValue).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Record any agreed supplier credit separately against an invoice.</small>
              </article>
            ))}
          </div>
        </details>
      )}
      <SupplierInvoicePanel
        purchaseOrderId={order.id}
        purchaseOrderStatus={order.status}
        currency={currency}
        receivedNetValue={order.receivedNetValue}
        businessDate={businessDate}
        dueSoonEndDate={dueSoonEndDate}
        invoices={order.invoices}
        canManageInvoices={canManageInvoices}
      />
      {cancellable && (
        <form
          action={cancelAction}
          className="purchase-cancel-form"
          onSubmit={(event) => {
            if (!window.confirm(`Cancel purchase order #${order.number}? This cannot be undone.`)) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="purchaseOrderId" value={order.id} />
          {cancelState.message && <p className={cancelState.status === "error" ? "form-error" : "form-success"} role={cancelState.status === "error" ? "alert" : "status"}>{cancelState.message}</p>}
          <button className="button-quiet purchase-cancel-button" type="submit" disabled={cancelPending}>
            {cancelPending ? "Cancelling order..." : "Cancel purchase order"}
          </button>
        </form>
      )}
    </article>
  );
}
