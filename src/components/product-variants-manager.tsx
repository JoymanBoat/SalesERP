"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { createProductVariant, createProductVariantBatch, deleteProductVariant, updateProductVariant } from "@/app/products/actions";
import { buildVariantCombinations, variantBatchOptionsSchema } from "@/lib/variant-batch";

const initialState = { status: "idle" as const, message: "" };

type Variant = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unitPrice: string;
  costPrice: string | null;
  inventoryLevels: { quantity: number; reorderPoint: number }[];
  optionValues: { optionId: string; value: string; option: { name: string } }[];
};

type ProductOption = { id: string; name: string };

function ProductVariantBatch({ productId, options }: { productId: string; options: ProductOption[] }) {
  const [state, action, pending] = useActionState(createProductVariantBatch, initialState);
  const [values, setValues] = useState<Record<string, string>>({});
  const selected = options.flatMap(({ id }) => {
    const raw = values[id]?.trim();
    return raw ? [{ optionId: id, values: raw.split(",").map((value) => value.trim()) }] : [];
  });
  const parsed = variantBatchOptionsSchema.safeParse(selected);
  const combinations = parsed.success ? buildVariantCombinations(parsed.data) : [];
  const namesTooLong = combinations.some((combination) => combination.map(({ value }) => value).join(" / ").length > 80);

  useEffect(() => {
    if (state.status === "success") setValues({});
  }, [state]);

  if (!options.length) return null;
  return (
    <form action={action} className="product-variant-editor">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="options" value={JSON.stringify(selected)} />
      <strong>Generate variants</strong>
      <p className="table-secondary">Enter comma-separated values for each option to use. Each combination receives a generated SKU and zero opening stock.</p>
      <div className="form-grid">
        {options.map((option) => (
          <label key={option.id}>{option.name}
            <input maxLength={1000} value={values[option.id] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [option.id]: event.target.value }))} placeholder="e.g. Small, Medium, Large" />
          </label>
        ))}
        <label>Price · GHS<input name="unitPrice" type="number" min="0.01" max="9999999999.99" step="0.01" required /></label>
        <label>Unit cost · GHS<input name="costPrice" type="number" min="0" max="9999999999.99" step="0.01" /></label>
        <label>Reorder point<input name="reorderPoint" type="number" min="0" max="1000000" step="1" defaultValue="5" required /></label>
      </div>
      {selected.length > 0 && !parsed.success && <p className="inline-error" role="alert">{parsed.error.issues[0]?.message}</p>}
      {namesTooLong && <p className="inline-error" role="alert">Each combined variant name must be at most 80 characters.</p>}
      {parsed.success && (
        <div>
          <p>Preview: {combinations.length} variant{combinations.length === 1 ? "" : "s"}</p>
          <ul>{combinations.map((combination) => <li key={JSON.stringify(combination)}>{combination.map(({ value }) => value).join(" / ")}</li>)}</ul>
        </div>
      )}
      {state.message && <p className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="button-quiet" type="submit" disabled={pending || !parsed.success || namesTooLong}>{pending ? "Creating..." : "Create variants"}</button>
    </form>
  );
}

function ProductVariantEditor({
  productId,
  variant,
  canDelete,
  options,
}: {
  productId: string;
  variant: Variant;
  canDelete: boolean;
  options: ProductOption[];
}) {
  const [state, action, pending] = useActionState(updateProductVariant, initialState);
  const [deleteState, deleteAction, deleting] = useActionState(deleteProductVariant, initialState);
  const [optionValues, setOptionValues] = useState<Record<string, string>>(
    Object.fromEntries(variant.optionValues.map(({ optionId, value }) => [optionId, value])),
  );

  return (
    <div className="product-variant-editor">
      <form action={action}>
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="variantId" value={variant.id} />
        <input type="hidden" name="optionValues" value={JSON.stringify(options.map(({ id }) => ({ optionId: id, value: optionValues[id] ?? "" })))} />
        <strong>{variant.name} · {variant.sku}</strong>
        <div className="form-grid">
          <label>Variant name<input name="name" required maxLength={80} defaultValue={variant.name} /></label>
          <label>SKU<input name="sku" required minLength={2} maxLength={64} defaultValue={variant.sku} /></label>
          <label>Barcode<input name="barcode" maxLength={64} defaultValue={variant.barcode ?? ""} /></label>
          <label>Price · GHS<input name="unitPrice" type="number" min="0.01" max="9999999999.99" step="0.01" required defaultValue={variant.unitPrice} /></label>
          <label>Unit cost · GHS<input name="costPrice" type="number" min="0" max="9999999999.99" step="0.01" defaultValue={variant.costPrice ?? ""} /></label>
          {options.map((option) => (
            <label key={option.id}>{option.name.replace(/^./, (letter) => letter.toLocaleUpperCase())}
              <input
                maxLength={80}
                value={optionValues[option.id] ?? ""}
                onChange={(event) => setOptionValues((current) => ({ ...current, [option.id]: event.target.value }))}
                placeholder={`Enter ${option.name}`}
              />
            </label>
          ))}
        </div>
        <p className="product-variant-stock">Current stock: {variant.inventoryLevels[0]?.quantity ?? 0}</p>
        {state.message && <p className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
        <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Saving..." : "Save variant"}</button>
      </form>
      {canDelete ? (
        <form action={deleteAction} className="product-status-form" onSubmit={(event) => {
          if (!window.confirm(`Delete ${variant.name} (${variant.sku})? This is allowed only when it has zero stock and no inventory, sales, or purchasing history.`)) event.preventDefault();
        }}>
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="variantId" value={variant.id} />
          <button type="submit" className="product-status-button" disabled={deleting}>{deleting ? "Deleting..." : "Delete variant"}</button>
          {deleteState.message && <small className={deleteState.status === "error" ? "inline-error" : "inline-success"} role={deleteState.status === "error" ? "alert" : "status"}>{deleteState.message}</small>}
        </form>
      ) : <small className="table-secondary">At least one variant must remain.</small>}
    </div>
  );
}

export function ProductVariantsManager({
  productId,
  variants,
  options,
}: {
  productId: string;
  variants: Variant[];
  options: ProductOption[];
}) {
  const [state, action, pending] = useActionState(createProductVariant, initialState);
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      setOptionValues({});
    }
  }, [state, setOptionValues]);

  return (
    <details className="product-variants">
      <summary>Manage variants ({variants.length})</summary>
      <div className="product-variants-content">
        {variants.map((variant) => (
          <ProductVariantEditor key={variant.id} productId={productId} variant={variant} canDelete={variants.length > 1} options={options} />
        ))}
        <ProductVariantBatch productId={productId} options={options} />
        <form action={action} className="product-variant-editor" ref={formRef}>
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="optionValues" value={JSON.stringify(options.map(({ id }) => ({ optionId: id, value: optionValues[id] ?? "" })))} />
          <strong>Add a variant</strong>
          <div className="form-grid">
            <label>Variant name<input name="name" required maxLength={80} placeholder="e.g. Large / Blue" /></label>
            <label>SKU<input name="sku" minLength={2} maxLength={64} placeholder="Leave blank to generate" /></label>
            <label>Barcode<input name="barcode" maxLength={64} /></label>
            <label>Price · GHS<input name="unitPrice" type="number" min="0.01" max="9999999999.99" step="0.01" required /></label>
            <label>Unit cost · GHS<input name="costPrice" type="number" min="0" max="9999999999.99" step="0.01" /></label>
            <label>Opening stock<input name="initialStock" type="number" min="0" max="1000000" step="1" defaultValue="0" required /></label>
            <label>Reorder point<input name="reorderPoint" type="number" min="0" max="1000000" step="1" defaultValue="5" required /></label>
            {options.map((option) => (
              <label key={option.id}>{option.name.replace(/^./, (letter) => letter.toLocaleUpperCase())}
                <input
                  maxLength={80}
                  value={optionValues[option.id] ?? ""}
                  onChange={(event) => setOptionValues((current) => ({ ...current, [option.id]: event.target.value }))}
                  placeholder={`Enter ${option.name}`}
                />
              </label>
            ))}
          </div>
          {state.message && <p className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
          <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Adding..." : "Add variant"}</button>
        </form>
      </div>
    </details>
  );
}
