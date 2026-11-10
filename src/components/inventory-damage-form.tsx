"use client";

import { useActionState } from "react";
import { useEffect, useRef } from "react";

import { writeOffDamagedStock } from "@/app/inventory/actions";

const initialState = { status: "idle" as const, message: "" };

export function InventoryDamageForm({
  variantId,
  available,
}: {
  variantId: string;
  available: number;
}) {
  const [state, action, pending] = useActionState(writeOffDamagedStock, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <details className="inventory-damage">
      <summary>Write off damage</summary>
      <form action={action} className="inventory-damage-form" ref={formRef}>
        <input type="hidden" name="variantId" value={variantId} />
        <label>
          Damaged units (up to {available} available)
          <input name="quantity" type="number" min="1" max={available} step="1" required disabled={available < 1} />
        </label>
        <label>
          Damage reason
          <input name="reason" type="text" minLength={3} maxLength={160} placeholder="e.g. Broken during handling" required disabled={available < 1} />
        </label>
        {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
        <button className="button-quiet" type="submit" disabled={pending || available < 1}>{pending ? "Saving..." : "Write off"}</button>
      </form>
    </details>
  );
}
