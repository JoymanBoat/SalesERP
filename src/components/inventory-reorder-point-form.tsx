"use client";

import { useActionState } from "react";

import { updateInventoryReorderPoint } from "@/app/inventory/actions";

const initialState = { status: "idle" as const, message: "" };

export function InventoryReorderPointForm({
  variantId,
  reorderPoint,
}: {
  variantId: string;
  reorderPoint: number;
}) {
  const [state, action, pending] = useActionState(updateInventoryReorderPoint, initialState);

  return (
    <details className="inventory-reorder-point">
      <summary>{reorderPoint}</summary>
      <form action={action} className="inventory-reorder-point-form">
        <input type="hidden" name="variantId" value={variantId} />
        <input type="hidden" name="expectedReorderPoint" value={reorderPoint} />
        <label>
          Reorder when on hand is at or below
          <input name="reorderPoint" type="number" min="0" max="1000000" step="1" defaultValue={reorderPoint} required />
        </label>
        {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
        <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Saving..." : "Save point"}</button>
      </form>
    </details>
  );
}
