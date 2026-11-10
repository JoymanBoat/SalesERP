"use client";

import { useActionState, useEffect, useRef } from "react";

import { createProduct } from "@/app/products/actions";
import { GRA_TAX_INFORMATION_URL, TAX_TREATMENTS, TAX_TREATMENT_LABELS } from "@/lib/tax";

const initialProductActionState = { status: "idle" as const, message: "" };

export function ProductForm({ categories }: { categories: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(createProduct, initialProductActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form action={action} className="record-form" ref={formRef}>
      <label>Product name<input name="name" required minLength={2} maxLength={120} /></label>
      <div className="form-grid">
        <label>SKU<input name="sku" required minLength={2} maxLength={64} autoCapitalize="characters" /></label>
        <label>Barcode <span className="optional-label">Optional</span><input name="barcode" maxLength={64} inputMode="numeric" /></label>
      </div>
      <div className="form-grid">
        <label>Category <span className="optional-label">Optional</span><select name="category" defaultValue=""><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label>
        <label>Selling price · GHS<input name="unitPrice" type="number" min="0.01" max="9999999999.99" step="0.01" required /></label>
      </div>
      <div className="form-grid">
        <label>Unit cost · GHS <span className="optional-label">Optional</span><input name="costPrice" type="number" min="0" max="9999999999.99" step="0.01" /></label>
        <label>Opening stock<input name="initialStock" type="number" min="0" max="1000000" step="1" defaultValue="0" required /></label>
      </div>
      <label>Reorder point<input name="reorderPoint" type="number" min="0" max="1000000" step="1" defaultValue="5" required /></label>
      <label>Tax treatment<select name="taxTreatment" defaultValue="STANDARD">{TAX_TREATMENTS.map((value) => <option key={value} value={value}>{TAX_TREATMENT_LABELS[value]}</option>)}</select></label>
      <p className="register-shift-disclaimer">Only Standard items are taxed at checkout using configured rates. Zero-rated, exempt and relieved items always get zero tax. Not tax advice; confirm with the <a href={GRA_TAX_INFORMATION_URL} target="_blank" rel="noreferrer">Ghana Revenue Authority</a>.</p>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="button-primary" type="submit" disabled={pending}>{pending ? "Saving product..." : "Add product"}</button>
    </form>
  );
}
