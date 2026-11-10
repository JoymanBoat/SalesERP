"use client";

import { useActionState, useEffect, useRef } from "react";

import { createPromotion, setPromotionActive } from "@/app/promotions/actions";

const initialState = { status: "idle" as const, message: "" };

type Promotion = {
  id: string;
  name: string;
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: string;
  minimumSubtotal: string;
  startsOn: string | null;
  endsOn: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  active: boolean;
  products: Array<{ id: string; name: string }>;
};

type PromotionProductOption = { id: string; name: string };

function PromotionStatusButton({ promotion }: { promotion: Promotion }) {
  const [state, action, pending] = useActionState(setPromotionActive, initialState);

  return (
    <form action={action} className="product-status-form">
      <input type="hidden" name="promotionId" value={promotion.id} />
      <input type="hidden" name="active" value={String(!promotion.active)} />
      <button className="product-status-button" type="submit" disabled={pending}>
        {pending ? "Saving..." : promotion.active ? "Deactivate" : "Activate"}
      </button>
      {state.message && <small className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</small>}
    </form>
  );
}

export function PromotionManager({ promotions, currency, products, totalCount }: { promotions: Promotion[]; currency: string; products: PromotionProductOption[]; totalCount: number }) {
  const [state, action, pending] = useActionState(createPromotion, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <div className="catalog-layout">
      <section className="data-panel catalog-table-panel">
        <div className="panel-title-row"><div><h2>Promotion codes</h2><p>Redemptions are counted only when a sale is completed.</p></div><span className="table-count">{totalCount.toLocaleString("en-GH")} codes</span></div>
        <div className="table-scroll">
          <table className="data-table operational-table">
            <thead><tr><th>Promotion</th><th>Discount</th><th>Eligible products</th><th>Minimum spend</th><th>Validity</th><th>Redemptions</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {promotions.map((promotion) => (
                <tr key={promotion.id}>
                  <td><strong>{promotion.name}</strong><small className="table-secondary">{promotion.code}</small></td>
                  <td>{promotion.type === "PERCENTAGE" ? `${Number(promotion.value).toFixed(2)}%` : `${currency} ${Number(promotion.value).toFixed(2)}`}</td>
                  <td>{promotion.products.length ? promotion.products.map(({ name }) => name).join(", ") : "All products"}</td>
                  <td>{Number(promotion.minimumSubtotal) > 0 ? `${currency} ${Number(promotion.minimumSubtotal).toFixed(2)}` : "None"}</td>
                  <td>{promotion.startsOn || promotion.endsOn
                    ? `${promotion.startsOn ?? "Any date"} – ${promotion.endsOn ?? "No end"}`
                    : "Always"}</td>
                  <td>{promotion.redemptionCount}{promotion.maxRedemptions === null ? " / unlimited" : ` / ${promotion.maxRedemptions}`}</td>
                  <td><span className={`order-status order-status-${promotion.active ? "paid" : "cancelled"}`}>{promotion.active ? "Active" : "Inactive"}</span></td>
                  <td><PromotionStatusButton promotion={promotion} /></td>
                </tr>
              ))}
              {promotions.length === 0 && <tr><td className="table-empty" colSpan={8}>No promotions yet. Create a code to offer a fixed or percentage discount.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="form-panel">
        <p className="eyebrow">Point of sale</p>
        <h2>New promotion</h2>
        <p className="form-intro">Create an organization-wide discount code. Optionally limit it to selected products. A redemption is consumed only after a sale is paid.</p>
        <form action={action} className="record-form" ref={formRef}>
          <label>Promotion name<input name="name" required minLength={2} maxLength={80} /></label>
          <label>Code<input name="code" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" autoCapitalize="characters" /></label>
          <label>Discount type
            <select name="type" defaultValue="PERCENTAGE">
              <option value="PERCENTAGE">Percentage</option>
              <option value="FIXED">Fixed amount</option>
            </select>
          </label>
          <label>Discount value<input name="value" type="number" min="0.01" max="10000000000" step="0.01" required /></label>
          <small className="table-secondary">Percentage values are capped at 100. Fixed discounts cannot exceed the cart subtotal. Fixed discounts use {currency}.</small>
          <fieldset className="promotion-product-select">
            <legend>Eligible products <span className="optional-label">Optional; leave unselected to include all products</span></legend>
            <div className="promotion-product-options">
              {products.map((product) => (
                <label key={product.id}><input type="checkbox" name="productIds" value={product.id} /><span>{product.name}</span></label>
              ))}
              {products.length === 0 && <small className="table-secondary">Create an active product first to restrict this promotion.</small>}
            </div>
          </fieldset>
          <label>Minimum spend ({currency}) <span className="optional-label">Optional; 0 means no minimum</span><input name="minimumSubtotal" type="number" min="0" max="9999999999.99" step="0.01" defaultValue="0" /></label>
          <label>Start date <span className="optional-label">Optional; uses your business timezone</span><input name="startsOn" type="date" /></label>
          <label>End date <span className="optional-label">Optional; inclusive</span><input name="endsOn" type="date" /></label>
          <label>Maximum redemptions <span className="optional-label">Optional; blank means unlimited</span><input name="maxRedemptions" type="number" min="1" max="1000000" step="1" /></label>
          {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
          <button className="button-primary" type="submit" disabled={pending}>{pending ? "Creating..." : "Create promotion"}</button>
        </form>
      </aside>
    </div>
  );
}
