"use client";

import { useActionState } from "react";

import { voidSale } from "@/app/pos/actions";

const initialState = { status: "idle" as const, message: "" };

export function VoidSaleForm({ orderId, number }: { orderId: string; number: number }) {
  const [state, action, pending] = useActionState(voidSale, initialState);

  return (
    <form action={action} className="pos-void-form" onSubmit={(event) => {
      if (!window.confirm(`Void held sale #${number}? This cannot be undone.`)) event.preventDefault();
    }}>
      <input type="hidden" name="orderId" value={orderId} />
      <label>
        Void reason
        <input name="reason" type="text" minLength={3} maxLength={160} required placeholder="Reason for voiding this cart" />
      </label>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
      <button className="button-quiet purchase-cancel-button" type="submit" disabled={pending}>{pending ? "Voiding..." : "Void held sale"}</button>
    </form>
  );
}
