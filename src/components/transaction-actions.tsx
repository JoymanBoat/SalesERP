"use client";

import { useActionState, useEffect, useState } from "react";

import { refundSale, returnSaleItems } from "@/app/pos/actions";

const initialState = { status: "idle" as const, message: "" };

type ReturnLine = {
  itemId: string;
  quantity: number;
  remaining: number;
  productName: string;
  sku: string;
  trackInventory: boolean;
};

export function TransactionActions({
  orderId,
  orderTotal,
  refundedTotal,
  items,
  canManage,
}: {
  orderId: string;
  orderTotal: string;
  refundedTotal: string;
  items: ReturnLine[];
  canManage: boolean;
}) {
  const [refundState, refundAction, refundPending] = useActionState(refundSale, initialState);
  const [returnState, returnAction, returnPending] = useActionState(returnSaleItems, initialState);
  const [refundKey, setRefundKey] = useState("");
  const [returnKey, setReturnKey] = useState("");
  const [returnLines, setReturnLines] = useState(items.map((item) => ({ itemId: item.itemId, quantity: 0, restock: false })));
  const remaining = Math.max(0, Number(orderTotal) - Number(refundedTotal));

  useEffect(() => {
    setRefundKey(crypto.randomUUID());
    setReturnKey(crypto.randomUUID());
  }, []);

  if (!canManage || remaining <= 0) return null;

  const returnableItems = items.filter((item) => item.remaining > 0);

  return (
    <div className="transaction-actions">
      <details>
        <summary>Issue cash refund</summary>
        <form action={refundAction} className="transaction-action-form">
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="idempotencyKey" value={refundKey} />
          <label>Amount to refund (up to {remaining.toFixed(2)})
            <input name="amount" type="number" min="0.01" max={remaining.toFixed(2)} step="0.01" required />
          </label>
          <label>Reason
            <input name="reason" type="text" minLength={3} maxLength={160} required placeholder="Refund reason" />
          </label>
          {refundState.message && <span className={refundState.status === "error" ? "inline-error" : "inline-success"} role={refundState.status === "error" ? "alert" : "status"}>{refundState.message}</span>}
          <button className="button-quiet" type="submit" disabled={refundPending || !refundKey}>{refundPending ? "Recording..." : "Record cash refund"}</button>
        </form>
      </details>

      {returnableItems.length > 0 && (
        <details>
          <summary>Return sale items</summary>
          <form action={returnAction} className="transaction-action-form">
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="idempotencyKey" value={returnKey} />
            <input type="hidden" name="lines" value={JSON.stringify(returnLines.filter((line) => line.quantity > 0))} />
            {returnableItems.map((item) => (
              <div className="transaction-return-line" key={item.itemId}>
                <span>{item.productName} · {item.sku} · {item.remaining} returnable</span>
                <label>Qty
                  <input type="number" min="0" max={item.remaining} step="1" value={returnLines.find((line) => line.itemId === item.itemId)?.quantity ?? 0}
                    onChange={(event) => setReturnLines((current) => current.map((line) => line.itemId === item.itemId ? { ...line, quantity: Number(event.target.value) } : line))} />
                </label>
                {item.trackInventory && (
                  <label className="transaction-restock-check">
                    <input type="checkbox" checked={returnLines.find((line) => line.itemId === item.itemId)?.restock ?? false}
                      onChange={(event) => setReturnLines((current) => current.map((line) => line.itemId === item.itemId ? { ...line, restock: event.target.checked } : line))} />
                    Restock
                  </label>
                )}
              </div>
            ))}
            <label>Return reason
              <input name="reason" type="text" minLength={3} maxLength={160} required placeholder="Reason for return" />
            </label>
            {returnState.message && <span className={returnState.status === "error" ? "inline-error" : "inline-success"} role={returnState.status === "error" ? "alert" : "status"}>{returnState.message}</span>}
            <button className="button-quiet" type="submit" disabled={returnPending || !returnKey || returnLines.every((line) => line.quantity < 1)}>{returnPending ? "Recording..." : "Return items and refund"}</button>
          </form>
        </details>
      )}
    </div>
  );
}
