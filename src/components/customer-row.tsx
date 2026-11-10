"use client";

import { useActionState } from "react";
import Link from "next/link";

import { setCustomerActive, updateCustomer } from "@/app/customers/actions";

const idleState = { status: "idle" as const, message: "" };

export function CustomerRow({
  customer,
  currency,
  orderCount,
  totalSpend,
  canManage,
  showInactive,
  orders,
}: {
  customer: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    loyaltyPoints: number;
  };
  currency: string;
  orderCount: number;
  totalSpend: string;
  canManage: boolean;
  showInactive: boolean;
  orders: {
    id: string;
    number: number;
    status: string;
    createdAt: string;
    total: string;
    currency: string;
    storeName: string;
    items: {
      id: string;
      productName: string;
      sku: string;
      quantity: number;
      unitPrice: string;
      lineTotal: string;
    }[];
    payments: {
      id: string;
      method: string;
      status: string;
      amount: string;
    }[];
  }[];
}) {
  const [updateState, updateAction, updatePending] = useActionState(updateCustomer, idleState);
  const [statusState, statusAction, statusPending] = useActionState(setCustomerActive, idleState);

  return (
    <tr>
      <td>
        <strong>{customer.firstName}{customer.lastName ? ` ${customer.lastName}` : ""}</strong>
        {customer.notes && <small className="table-secondary customer-notes">{customer.notes}</small>}
        {canManage && !showInactive && (
          <details className="customer-edit">
            <summary>Edit details</summary>
            <form action={updateAction} className="customer-edit-form">
              <input type="hidden" name="customerId" value={customer.id} />
              <label>First name<input name="firstName" required minLength={2} maxLength={80} defaultValue={customer.firstName} /></label>
              <label>Last name<input name="lastName" maxLength={80} defaultValue={customer.lastName ?? ""} /></label>
              <label>Email<input name="email" type="email" maxLength={254} defaultValue={customer.email ?? ""} /></label>
              <label>Phone<input name="phone" type="tel" maxLength={32} defaultValue={customer.phone ?? ""} /></label>
              <label>Notes<textarea name="notes" maxLength={500} rows={2} defaultValue={customer.notes ?? ""} /></label>
              {updateState.message && (
                <p className={updateState.status === "error" ? "inline-error" : "inline-success"} role={updateState.status === "error" ? "alert" : "status"}>
                  {updateState.message}
                </p>
              )}
              <button className="button-quiet" type="submit" disabled={updatePending}>
                {updatePending ? "Saving..." : "Save changes"}
              </button>
            </form>
          </details>
        )}
      </td>
      <td>{customer.email ?? customer.phone ?? "—"}{customer.email && customer.phone && <small className="table-secondary">{customer.phone}</small>}</td>
      <td>
        {orderCount}
        <details className="customer-history">
          <summary>Purchase history · {orders.length}{orders.length === 10 ? "+" : ""}</summary>
          {orders.length ? (
            <div className="customer-history-list">
              {orders.map((order) => (
                <article className="customer-order" key={order.id}>
                  <header className="customer-order-header">
                    <strong>Order #{order.number}</strong>
                    <span className={`order-status order-status-${order.status.toLowerCase()}`}>{order.status.replaceAll("_", " ")}</span>
                  </header>
                  <p className="customer-order-meta">{order.createdAt} · {order.storeName}</p>
                  {order.items.length ? (
                    <ul className="customer-order-items">
                      {order.items.map((item) => (
                        <li key={item.id}>
                          <span>{item.productName}<small>{item.sku} · {item.quantity} × {order.currency} {Number(item.unitPrice).toFixed(2)}</small></span>
                          <strong>{order.currency} {Number(item.lineTotal).toFixed(2)}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="customer-order-meta">No item details recorded.</p>}
                  <div className="customer-order-footer">
                    <span>Order total</span>
                    <strong>{order.currency} {Number(order.total).toFixed(2)}</strong>
                  </div>
                  {order.payments.length > 0 && (
                    <ul className="customer-payment-list">
                      {order.payments.map((payment) => (
                        <li key={payment.id}>
                          {payment.method.replaceAll("_", " ")} · {payment.status.replaceAll("_", " ")}
                          <strong>{order.currency} {Number(payment.amount).toFixed(2)}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
              <Link className="customer-history-all-link" href={`/customers/${customer.id}/history`}>View full purchase history</Link>
            </div>
          ) : <p className="customer-order-meta">No recorded orders yet.</p>}
        </details>
      </td>
      <td>
        {currency} {Number(totalSpend).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        {canManage && (
          <form action={statusAction} className="customer-status-form">
            <input type="hidden" name="customerId" value={customer.id} />
            <input type="hidden" name="active" value={showInactive ? "true" : "false"} />
            <button type="submit" className="customer-status-button" disabled={statusPending}>
              {statusPending ? "Updating..." : showInactive ? "Reactivate" : "Deactivate"}
            </button>
            {statusState.message && (
              <small className={statusState.status === "error" ? "inline-error" : "inline-success"} role={statusState.status === "error" ? "alert" : "status"}>
                {statusState.message}
              </small>
            )}
          </form>
        )}
      </td>
      <td>{customer.loyaltyPoints.toLocaleString("en-GH")}<small className="table-secondary">100 points = {currency} 1</small></td>
    </tr>
  );
}
