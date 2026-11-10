"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

import { setProductArchived, updateProduct } from "@/app/products/actions";
import { TAX_TREATMENTS, TAX_TREATMENT_LABELS, type TaxTreatmentValue } from "@/lib/tax";

const idleState = { status: "idle" as const, message: "" };

export function ProductRow({
  product,
  canManage,
  showArchived,
  variantsManager,
  categories,
}: {
  product: {
    id: string;
    name: string;
    taxTreatment: TaxTreatmentValue;
    category: { name: string } | null;
    variants: {
      id: string;
      name: string;
      sku: string;
      barcode: string | null;
      unitPrice: string;
      costPrice: string | null;
      inventoryLevels: { quantity: number; reorderPoint: number }[];
    }[];
  };
  canManage: boolean;
  showArchived: boolean;
  variantsManager: ReactNode;
  categories: Array<{ id: string; name: string }>;
}) {
  const [updateState, updateAction, updatePending] = useActionState(updateProduct, idleState);
  const [statusState, statusAction, statusPending] = useActionState(setProductArchived, idleState);
  const variant = product.variants[0];
  const totalStock = product.variants.reduce((total, item) => total + (item.inventoryLevels[0]?.quantity ?? 0), 0);
  const totalReorderPoint = product.variants.reduce((total, item) => total + (item.inventoryLevels[0]?.reorderPoint ?? 0), 0);
  const lowestPrice = product.variants.reduce(
    (lowest, item) => Math.min(lowest, Number(item.unitPrice)),
    Number.POSITIVE_INFINITY,
  );
  const lowStock = totalStock <= totalReorderPoint;

  return (
    <tr>
      <td>
        <strong>{product.name}</strong>
        {variant && <small className="table-secondary">Primary variant · {variant.name}</small>}
        <small className="table-secondary">Tax treatment · {TAX_TREATMENT_LABELS[product.taxTreatment]}</small>
        {variant?.barcode && <small className="table-secondary">Barcode · {variant.barcode}</small>}
        {canManage && !showArchived && variant && (
          <details className="product-edit">
            <summary>Edit product</summary>
            <form action={updateAction} className="product-edit-form">
              <input type="hidden" name="productId" value={product.id} />
              <label>Product name<input name="name" required minLength={2} maxLength={120} defaultValue={product.name} /></label>
              <label>SKU<input name="sku" required minLength={2} maxLength={64} defaultValue={variant.sku} /></label>
              <label>Barcode<input name="barcode" maxLength={64} defaultValue={variant.barcode ?? ""} /></label>
              <label>Category<select name="category" defaultValue={product.category?.name ?? ""}><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label>
              <label>Selling price · GHS<input name="unitPrice" type="number" min="0.01" max="9999999999.99" step="0.01" required defaultValue={variant.unitPrice} /></label>
              <label>Unit cost · GHS<input name="costPrice" type="number" min="0" max="9999999999.99" step="0.01" defaultValue={variant.costPrice ?? ""} /></label>
              <label>Tax treatment<select name="taxTreatment" defaultValue={product.taxTreatment}>{TAX_TREATMENTS.map((value) => <option key={value} value={value}>{TAX_TREATMENT_LABELS[value]}</option>)}</select></label>
              {updateState.message && (
                <p className={updateState.status === "error" ? "inline-error" : "inline-success"} role={updateState.status === "error" ? "alert" : "status"}>
                  {updateState.message}
                </p>
              )}
              <button className="button-quiet" type="submit" disabled={updatePending}>
                {updatePending ? "Saving..." : "Save changes"}
              </button>
            </form>
          </details>
        )}
        {variantsManager}
      </td>
      <td>{variant?.sku ?? "—"}{product.variants.length > 1 && <small className="table-secondary">+ {product.variants.length - 1} more variants</small>}</td>
      <td>{product.category?.name ?? "Uncategorized"}</td>
      <td>{Number.isFinite(lowestPrice) ? `${product.variants.length > 1 ? "From " : ""}GH₵${lowestPrice.toFixed(2)}` : "—"}</td>
      <td><span className={`stock-value${lowStock ? " stock-low" : ""}`}>{totalStock}</span>{product.variants.length > 1 && <small className="table-secondary">All variants</small>}</td>
      {canManage && (
        <td>
          <form action={statusAction} className="product-status-form">
            <input type="hidden" name="productId" value={product.id} />
            <input type="hidden" name="archived" value={showArchived ? "false" : "true"} />
            <button type="submit" className="product-status-button" disabled={statusPending}>
              {statusPending ? "Updating..." : showArchived ? "Restore" : "Archive"}
            </button>
            {statusState.message && <small className="inline-error" role="alert">{statusState.message}</small>}
          </form>
        </td>
      )}
    </tr>
  );
}
