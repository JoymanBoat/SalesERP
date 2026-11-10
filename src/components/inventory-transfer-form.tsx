"use client";

import { useActionState, useEffect, useRef } from "react";

import { transferInventory } from "@/app/inventory/actions";

const initialState = { status: "idle" as const, message: "" };

export function InventoryTransferForm({
  variants,
  stores,
}: {
  variants: { id: string; name: string; productName: string; sku: string; available: number }[];
  stores: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(transferInventory, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form action={action} className="record-form inventory-transfer-form" ref={formRef}>
      <label>
        Product variant
        <select name="variantId" required defaultValue="">
          <option value="" disabled>Select a variant</option>
          {variants.map((variant) => (
            <option key={variant.id} value={variant.id} disabled={variant.available < 1}>
              {variant.productName} · {variant.name} · {variant.sku} · {variant.available} available
            </option>
          ))}
        </select>
        <span className="field-hint">Lists the variants shown in the stock table. Search or page the table to find others.</span>
      </label>
      <div className="form-grid">
        <label>
          Destination store
          <select name="toStoreId" required defaultValue="">
            <option value="" disabled>Select a store</option>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </label>
        <label>
          Quantity
          <input name="quantity" type="number" min="1" max="1000000" step="1" required />
        </label>
      </div>
      <label>Reason or reference<input name="reason" minLength={3} maxLength={160} required placeholder="e.g. Replenishment request" /></label>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="button-primary" type="submit" disabled={pending || variants.length === 0 || stores.length === 0}>
        {pending ? "Transferring..." : "Transfer stock"}
      </button>
      {variants.length === 0 && <p className="permission-note">No active variants have stock records in this store.</p>}
    </form>
  );
}
