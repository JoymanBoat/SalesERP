"use client";

import { useActionState } from "react";

import { reconcileInventoryCount } from "@/app/inventory/actions";

const initialState = { status: "idle" as const, message: "" };

export function InventoryCountForm({
  variantId,
  quantity,
}: {
  variantId: string;
  quantity: number;
}) {
  const [state, action, pending] = useActionState(reconcileInventoryCount, initialState);

  return (
    <details className="inventory-count">
      <summary>Reconcile count</summary>
      <form action={action} className="inventory-count-form">
        <input type="hidden" name="variantId" value={variantId} />
        <input type="hidden" name="expectedQuantity" value={quantity} />
        <label>
          Physical count
          <input name="countedQuantity" type="number" min="0" max="1000000" step="1" defaultValue={quantity} required />
        </label>
        <label>
          Count note
          <input name="reason" type="text" minLength={3} maxLength={160} placeholder="Count note or reference" required />
        </label>
        {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
        <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Reconciling..." : "Apply count"}</button>
      </form>
    </details>
  );
}
