"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { createPurchaseOrder } from "@/app/purchasing/actions";

type PurchaseOrderLine = {
  key: number;
  variantId: string;
  quantity: number;
  unitCost: string;
};

const initialState = { status: "idle" as const, message: "" };

export function PurchaseOrderForm({
  suppliers,
  variants,
  initialLine,
}: {
  suppliers: { id: string; businessName: string }[];
  variants: { id: string; name: string; sku: string; unitCost: string }[];
  initialLine?: { variantId: string; quantity: number };
}) {
  const [state, action, pending] = useActionState(createPurchaseOrder, initialState);
  const [lines, setLines] = useState<PurchaseOrderLine[]>(() => {
    const variant = initialLine ? variants.find(({ id }) => id === initialLine.variantId) : undefined;
    return initialLine && variant
      ? [{ key: 0, variantId: variant.id, quantity: initialLine.quantity, unitCost: variant.unitCost }]
      : [{ key: 0, variantId: "", quantity: 1, unitCost: "0" }];
  });
  const [nextKey, setNextKey] = useState(1);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      setLines([{ key: 0, variantId: "", quantity: 1, unitCost: "0" }]);
      setNextKey(1);
    }
  }, [state]);

  function updateLine(key: number, patch: Partial<PurchaseOrderLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  function addLine() {
    setLines((current) => [...current, { key: nextKey, variantId: "", quantity: 1, unitCost: "0" }]);
    setNextKey((current) => current + 1);
  }

  const lineTotal = lines.reduce((sum, line) => sum + Number(line.unitCost || 0) * line.quantity, 0);

  return (
    <form action={action} className="record-form" ref={formRef}>
      <label>Supplier
        <select name="supplierId" required defaultValue="">
          <option value="" disabled>Select a supplier</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.businessName}</option>)}
        </select>
      </label>
      <label>Expected delivery <span className="optional-label">Optional</span><input name="expectedAt" type="date" /></label>
      <div className="purchase-lines">
        <div className="purchase-lines-heading"><strong>Order items</strong><span>Up to 50 products</span></div>
        {lines.map((line) => (
          <div className="purchase-line" key={line.key}>
            <label>Product
              <select
                aria-label="Purchase order product"
                required
                value={line.variantId}
                onChange={(event) => {
                  const variant = variants.find((candidate) => candidate.id === event.target.value);
                  updateLine(line.key, {
                    variantId: event.target.value,
                    unitCost: variant?.unitCost ?? "0",
                  });
                }}
              >
                <option value="" disabled>Select a product</option>
                {variants.map((variant) => (
                  <option value={variant.id} key={variant.id} disabled={lines.some((other) => other.key !== line.key && other.variantId === variant.id)}>
                    {variant.name} · {variant.sku}
                  </option>
                ))}
              </select>
            </label>
            <div className="purchase-line-fields">
              <label>Quantity<input type="number" min="1" max="1000000" step="1" required value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: Number(event.target.value) })} /></label>
              <label>Unit cost · GHS<input type="number" min="0" max="9999999999.99" step="0.01" required value={line.unitCost} onChange={(event) => updateLine(line.key, { unitCost: event.target.value })} /></label>
            </div>
            {lines.length > 1 && <button className="purchase-remove-line" type="button" onClick={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}>Remove item</button>}
          </div>
        ))}
        <button className="button-quiet purchase-add-line" type="button" onClick={addLine} disabled={lines.length >= 50 || variants.length === 0}>Add another product</button>
      </div>
      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ variantId, quantity, unitCost }) => ({ variantId, quantity, unitCost })))} />
      <label>Notes <span className="optional-label">Optional</span><textarea name="notes" maxLength={500} rows={2} /></label>
      <p className="purchase-estimate">Estimated order total <strong>GHS {lineTotal.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></p>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="button-primary" type="submit" disabled={pending || suppliers.length === 0 || variants.length === 0}>
        {pending ? "Creating order..." : "Create purchase order"}
      </button>
      {suppliers.length === 0 && <p className="permission-note">Add an active supplier before creating purchase orders.</p>}
      {variants.length === 0 && <p className="permission-note">Add an active product before creating purchase orders.</p>}
    </form>
  );
}
