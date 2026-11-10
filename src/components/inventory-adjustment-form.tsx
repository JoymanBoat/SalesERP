"use client";

import { useActionState } from "react";
import { useEffect, useRef } from "react";

import { adjustInventory } from "@/app/inventory/actions";

const initialInventoryActionState = { status: "idle" as const, message: "" };

export function InventoryAdjustmentForm({ variantId }: { variantId: string }) {
  const [state, action, pending] = useActionState(adjustInventory, initialInventoryActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form action={action} className="adjustment-form" ref={formRef}>
      <input name="variantId" type="hidden" value={variantId} />
      <label className="visually-hidden" htmlFor={`delta-${variantId}`}>Quantity change</label>
      <input id={`delta-${variantId}`} aria-label="Quantity change; use a negative number to remove stock" name="quantityDelta" type="number" step="1" min="-1000000" max="1000000" placeholder="+/- qty" required />
      <label className="visually-hidden" htmlFor={`reason-${variantId}`}>Adjustment reason</label>
      <input id={`reason-${variantId}`} aria-label="Adjustment reason" name="reason" type="text" minLength={3} maxLength={160} placeholder="Reason" required />
      <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Saving..." : "Adjust"}</button>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
    </form>
  );
}
