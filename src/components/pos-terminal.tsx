"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";

import { checkoutCash, saveSaleDraft } from "@/app/pos/actions";
import { calculatePromotionDiscount, calculateSaleTotals, eligiblePromotionSubtotal, findUniqueBarcodeMatch, loyaltyPointsDiscount, loyaltyPointsEarned, promotionIsWithinDates, promotionMeetsMinimumSubtotal } from "@/lib/pos";
import { formatGhanaCedis } from "@/lib/currency";
import { TAX_TREATMENT_LABELS, type TaxRates, type TaxTreatmentValue } from "@/lib/tax";
import { offlineCartSnapshotSchema } from "@/lib/validation";

type PosProduct = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: string;
  taxTreatment: TaxTreatmentValue;
  available: number | null;
  inventoryMissing: boolean;
};

type CartLine = { variantId: string; quantity: number };
type Draft = {
  id: string;
  updatedAt: string;
  customerId: string | null;
  giftCardId: string | null;
  giftCardLastFour: string | null;
  giftCardRedeemed: string;
  discountTotal: string;
  promotionCode: string;
  loyaltyPointsRedeemed: number;
  notes: string;
  lines: CartLine[];
  total: string;
};

type PosPromotion = {
  code: string;
  name: string;
  type: "PERCENTAGE" | "FIXED";
  value: string;
  minimumSubtotal: string;
  startsOn: string | null;
  endsOn: string | null;
  eligibleProductIds: string[];
};

const initialState = { status: "idle" as const, message: "" };

export function PosTerminal({
  products,
  customers,
  taxRates,
  currency,
  canDiscount,
  promotions,
  businessDate,
  initialDraft,
  offlineCartScope,
}: {
  products: PosProduct[];
  customers: Array<{ id: string; name: string; loyaltyPoints: number }>;
  taxRates: TaxRates;
  currency: string;
  canDiscount: boolean;
  promotions: PosPromotion[];
  businessDate: string;
  initialDraft?: Draft;
  offlineCartScope: { organizationId: string; storeId: string; registerId: string; membershipId: string };
}) {
  const [lines, setLines] = useState<CartLine[]>(initialDraft?.lines ?? []);
  const [customerId, setCustomerId] = useState(initialDraft?.customerId ?? "");
  const [discountTotal, setDiscountTotal] = useState(
    initialDraft?.promotionCode || initialDraft?.loyaltyPointsRedeemed ? "0.00" : initialDraft?.discountTotal ?? "0.00",
  );
  const [promotionCode, setPromotionCode] = useState(initialDraft?.promotionCode ?? "");
  const [loyaltyPointsRedeemed, setLoyaltyPointsRedeemed] = useState(initialDraft?.loyaltyPointsRedeemed ?? 0);
  const [notes, setNotes] = useState(initialDraft?.notes ?? "");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardId, setGiftCardId] = useState(initialDraft?.giftCardId ?? "");
  const [giftCardLastFour, setGiftCardLastFour] = useState(initialDraft?.giftCardLastFour ?? null);
  const [giftCardRedeemed, setGiftCardRedeemed] = useState(initialDraft?.giftCardRedeemed ?? "0.00");
  const [draftState, saveAction, saving] = useActionState(saveSaleDraft, initialState);
  const [checkoutState, checkoutAction, checkingOut] = useActionState(checkoutCash, initialState);
  const [filter, setFilter] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [localCartReady, setLocalCartReady] = useState(false);
  const [localCartSaved, setLocalCartSaved] = useState(false);
  const [recoveredLocalCart, setRecoveredLocalCart] = useState(false);
  const [syncedLinesKey, setSyncedLinesKey] = useState(() => JSON.stringify(initialDraft?.lines ?? []));
  const [offlineBaseUpdatedAt, setOfflineBaseUpdatedAt] = useState(initialDraft?.updatedAt ?? "");
  const [localCartConflict, setLocalCartConflict] = useState(false);
  const [needsServerReload, setNeedsServerReload] = useState(false);
  const [localCartMessage, setLocalCartMessage] = useState("");
  const [localCartError, setLocalCartError] = useState("");
  const localCartKey = `saleserp:pos-cart:v1:${offlineCartScope.organizationId}:${offlineCartScope.storeId}:${offlineCartScope.registerId}:${offlineCartScope.membershipId}:${initialDraft?.id ?? "new"}`;
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const pricedLines = lines.map((line) => {
    const product = productById.get(line.variantId);
    return product ? { ...line, unitPrice: product.price, productId: product.productId, taxTreatment: product.taxTreatment } : null;
  }).filter((line): line is CartLine & { unitPrice: string; productId: string; taxTreatment: TaxTreatmentValue } => line !== null);
  const selectedPromotion = promotions.find(({ code }) => code === promotionCode.trim().toUpperCase());
  const selectedCustomer = customers.find(({ id }) => id === customerId);
  let baseTotals;
  let effectiveDiscount = discountTotal || "0";
  let totals;
  let totalsError = "";
  let promotionEligibleVariantIds: string[] | undefined;
  try {
    if (loyaltyPointsRedeemed > 0) effectiveDiscount = loyaltyPointsDiscount(loyaltyPointsRedeemed);
    baseTotals = pricedLines.length ? calculateSaleTotals(pricedLines, "0", taxRates) : null;
    if (loyaltyPointsRedeemed > 0 && (promotionCode.trim() || Number(discountTotal) > 0)) {
      throw new RangeError("Redeem loyalty points separately from a promotion or manual discount.");
    }
    if (promotionCode.trim()) {
      promotionEligibleVariantIds = selectedPromotion?.eligibleProductIds.length
        ? pricedLines.filter((line) => selectedPromotion.eligibleProductIds.includes(line.productId)).map((line) => line.variantId)
        : undefined;
      const eligibleSubtotal = eligiblePromotionSubtotal(pricedLines, promotionEligibleVariantIds ?? null);
      if (
        !selectedPromotion ||
        !baseTotals ||
        !promotionIsWithinDates(selectedPromotion.startsOn, selectedPromotion.endsOn, businessDate) ||
        (promotionEligibleVariantIds !== undefined && promotionEligibleVariantIds.length === 0) ||
        !promotionMeetsMinimumSubtotal(eligibleSubtotal, selectedPromotion.minimumSubtotal)
      ) {
        throw new RangeError("That promotion code is unavailable, has no eligible products in the cart, or does not meet its eligible-product minimum spend.");
      }
      effectiveDiscount = calculatePromotionDiscount(eligibleSubtotal, selectedPromotion.type, selectedPromotion.value);
    }
    totals = pricedLines.length
      ? calculateSaleTotals(pricedLines, effectiveDiscount, taxRates, promotionEligibleVariantIds)
      : null;
  } catch (error) {
    totalsError = error instanceof Error ? error.message : "Check the discount amount.";
  }
  const normalizedFilter = filter.trim().toLowerCase();
  const visibleProducts = products.filter((product) =>
    !normalizedFilter || `${product.name} ${product.sku} ${product.barcode ?? ""}`.toLowerCase().includes(normalizedFilter));
  const effectiveOrderId = draftState.orderId ?? initialDraft?.id;
  const cashDue = totals
    ? Math.max(0, Number(totals.total) - Number(giftCardRedeemed))
    : Math.max(0, Number(initialDraft?.total ?? 0) - Number(giftCardRedeemed));
  const hasUnsyncedLocalCart = recoveredLocalCart || JSON.stringify(lines) !== syncedLinesKey;

  useEffect(() => {
    if (draftState.conflict) {
      setLocalCartConflict(true);
      setLocalCartError(draftState.message);
      return;
    }
    if (draftState.status !== "success") return;
    setGiftCardId(draftState.giftCardId ?? "");
    setGiftCardLastFour(draftState.giftCardLastFour ?? null);
    setGiftCardRedeemed(draftState.giftCardRedeemed ?? "0.00");
    setGiftCardCode("");
    if (draftState.orderId) {
      setSyncedLinesKey(JSON.stringify(lines));
      setOfflineBaseUpdatedAt(draftState.updatedAt ?? "");
    }
    setRecoveredLocalCart(false);
    setLocalCartConflict(false);
  }, [draftState, lines]);

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);

    try {
      const saved = window.localStorage.getItem(localCartKey);
      if (saved) {
        let value: unknown;
        try {
          value = JSON.parse(saved);
        } catch {
          value = null;
        }
        const parsed = offlineCartSnapshotSchema.safeParse(value);
        if (parsed.success) {
          setLines(parsed.data.lines);
          setLocalCartSaved(true);
          const differsFromServer = JSON.stringify(parsed.data.lines) !== JSON.stringify(initialDraft?.lines ?? []);
          const versionConflict = Boolean(initialDraft && parsed.data.expectedUpdatedAt !== initialDraft.updatedAt);
          setOfflineBaseUpdatedAt(parsed.data.expectedUpdatedAt ?? "");
          setRecoveredLocalCart(differsFromServer);
          setLocalCartConflict(versionConflict);
          if (versionConflict) {
            setLocalCartMessage("This held cart changed on the server while offline. Your local cart remains saved; discard local changes and reload to continue.");
          } else if (differsFromServer) {
            setLocalCartMessage("Recovered unsynced cart changes. Review and sync them before checkout.");
          }
        } else {
          window.localStorage.removeItem(localCartKey);
          setLocalCartError("A damaged local cart was discarded. Start a new cart or restore a server-held cart.");
        }
      }
    } catch (error) {
      console.error("The local POS cart could not be read.", error);
      setLocalCartError("This browser could not access the local cart. Keep the POS page open and reconnect before saving.");
    }
    setLocalCartReady(true);

    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, [initialDraft, localCartKey]);

  useEffect(() => {
    if (!localCartReady) return;
    try {
      if (draftState.status === "success" && draftState.orderId) {
        window.localStorage.removeItem(localCartKey);
        setLocalCartSaved(false);
        setRecoveredLocalCart(false);
        setLocalCartMessage("");
        setLocalCartError("");
        return;
      }
      if (initialDraft && !hasUnsyncedLocalCart) {
        window.localStorage.removeItem(localCartKey);
        setLocalCartSaved(false);
        return;
      }
      if (lines.length === 0 && !recoveredLocalCart && !initialDraft) {
        window.localStorage.removeItem(localCartKey);
        setLocalCartSaved(false);
        return;
      }
      const snapshot = {
        version: 1 as const,
        savedAt: new Date().toISOString(),
        ...(offlineBaseUpdatedAt ? { expectedUpdatedAt: offlineBaseUpdatedAt } : {}),
        lines,
      };
      const parsed = offlineCartSnapshotSchema.safeParse(snapshot);
      if (!parsed.success) {
        setLocalCartError("This cart cannot be saved locally. Review its items before continuing.");
        return;
      }
      window.localStorage.setItem(localCartKey, JSON.stringify(parsed.data));
      setLocalCartSaved(true);
      setLocalCartError("");
    } catch (error) {
      console.error("The local POS cart could not be saved.", error);
      setLocalCartError("This browser could not save the cart locally. Keep the POS page open and reconnect before saving.");
    }
  }, [draftState, hasUnsyncedLocalCart, initialDraft, lines, localCartKey, localCartReady, offlineBaseUpdatedAt, recoveredLocalCart]);

  function addProduct(productId: string) {
    const product = productById.get(productId);
    if (!product || (product.available !== null && product.available < 1)) return false;
    const existing = lines.find((line) => line.variantId === productId);
    if (existing && product.available !== null && existing.quantity >= product.available) return false;
    setLines((current) => {
      const existing = current.find((line) => line.variantId === productId);
      if (existing) {
        if (product.available !== null && existing.quantity >= product.available) return current;
        return current.map((line) => line.variantId === productId ? { ...line, quantity: line.quantity + 1 } : line);
      }
      return [...current, { variantId: productId, quantity: 1 }];
    });
    return true;
  }

  function discardLocalCart() {
    try {
      window.localStorage.removeItem(localCartKey);
      setLines(initialDraft?.lines ?? []);
      setSyncedLinesKey(JSON.stringify(initialDraft?.lines ?? []));
      setOfflineBaseUpdatedAt(initialDraft?.updatedAt ?? "");
      setRecoveredLocalCart(false);
      setLocalCartConflict(false);
      setLocalCartSaved(false);
      setLocalCartMessage("The unsynced local cart was discarded.");
      setLocalCartError("");
      setNeedsServerReload(localCartConflict);
      if (localCartConflict) setLocalCartMessage("Local changes were discarded. Reload the held cart to use its latest server version.");
    } catch (error) {
      console.error("The local POS cart could not be discarded.", error);
      setLocalCartError("The local cart could not be removed from this browser.");
    }
  }

  return (
    <div className="pos-terminal">
      {isOnline === false && <p className="permission-note" role="status">{hasUnsyncedLocalCart ? "Offline: unsynced cart changes are saved on this device. Server-held stock and checkout are unavailable; reconnect and sync before taking payment." : "Offline: server-held stock and checkout are unavailable. Reconnect before saving or completing a sale."}</p>}
      {isOnline === true && recoveredLocalCart && <p className="form-success" role="status">{localCartMessage}</p>}
      {isOnline === true && hasUnsyncedLocalCart && localCartSaved && !recoveredLocalCart && <p className="table-secondary" role="status">Unsynced cart changes are saved on this device. Sync them as a held cart before checkout.</p>}
      {localCartConflict && <p className="permission-note" role="alert">This held cart changed on the server. Your local cart remains saved; discard local changes before reloading the latest version.</p>}
      {needsServerReload && <div className="permission-note" role="status"><span>Reload this held cart to continue using current server data.</span><button className="button-quiet" type="button" onClick={() => window.location.reload()} disabled={isOnline !== true}>Reload held cart</button></div>}
      {localCartSaved && !recoveredLocalCart && !effectiveOrderId && lines.length > 0 && <p className="table-secondary" role="status">Cart changes are saved on this device. Save it as a held cart to reserve stock on the server.</p>}
      {localCartError && <p className="form-error" role="alert">{localCartError}</p>}
      <section className="data-panel pos-product-panel" aria-labelledby="pos-products-heading">
        <div className="panel-title-row"><div><h2 id="pos-products-heading">Products</h2><p>Select items to add them to the sale. Stock held by this cart remains available when you resume it.</p></div><span className="table-count">{products.length} listed</span></div>
        <a className="pos-mobile-jump" href="#pos-cart-heading">View current sale ({lines.length} {lines.length === 1 ? "item" : "items"})</a>
        <label className="visually-hidden" htmlFor="pos-product-search">Search products by name, SKU, or barcode; scan a barcode and press Enter to add it</label>
        <input
          id="pos-product-search"
          className="pos-product-search"
          type="search"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setScanMessage("");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !filter.trim()) return;
            event.preventDefault();
            const product = findUniqueBarcodeMatch(products, filter);
            if (!product) {
              setScanMessage("No unique active product matches that barcode.");
              return;
            }
            if (!addProduct(product.id)) {
              setScanMessage("No additional stock is available for that product.");
              return;
            }
            setFilter("");
            setScanMessage(`${product.name} added to the cart.`);
          }}
          placeholder="Search or scan barcode, then press Enter"
        />
        {scanMessage && <p className="table-secondary" role="status" aria-live="polite">{scanMessage}</p>}
        <div className="pos-product-list">
          {visibleProducts.map((product) => (
            <button className="pos-product-option" key={product.id} type="button" onClick={() => addProduct(product.id)} disabled={product.available !== null && product.available < 1}>
              <span><strong>{product.name}</strong><small>{product.sku} · {TAX_TREATMENT_LABELS[product.taxTreatment]}{product.inventoryMissing ? " · inventory record missing" : product.available === null ? " · stock not tracked" : ` · ${product.available} available`}</small></span>
              <strong>{currency} {Number(product.price).toFixed(2)}</strong>
            </button>
          ))}
          {visibleProducts.length === 0 && <p className="report-empty">No active products match this search.</p>}
        </div>
      </section>

      <section className="data-panel pos-cart-panel" aria-labelledby="pos-cart-heading">
        <div className="panel-title-row"><div><h2 id="pos-cart-heading">{initialDraft ? `Held sale #${initialDraft.id.slice(-6)}` : "Current sale"}</h2><p>Saving a held cart reserves tracked stock. Reservations are released at checkout or when a manager voids the cart.</p></div><Link className="report-export-link" href="/pos">New cart</Link></div>
        <a className="pos-mobile-jump" href="#pos-products-heading">Back to products</a>
        <form
          action={saveAction}
          className="pos-cart-form"
          onSubmit={(event) => {
            if (isOnline !== true || localCartConflict || needsServerReload) {
              event.preventDefault();
              setLocalCartMessage(isOnline !== true
                ? "The cart is saved locally. Reconnect to sync it as a held cart."
                : "This held cart changed on the server. Discard local changes and reload before continuing.");
            }
          }}
        >
          <input type="hidden" name="orderId" value={effectiveOrderId ?? ""} />
          <input type="hidden" name="expectedUpdatedAt" value={offlineBaseUpdatedAt} />
          <input type="hidden" name="lines" value={JSON.stringify(lines)} />
          <input type="hidden" name="giftCardId" value={giftCardId} />
          <label>
            Customer <span className="optional-label">Optional</span>
            <select name="customerId" value={customerId} onChange={(event) => {
              setCustomerId(event.target.value);
              setLoyaltyPointsRedeemed(0);
            }}>
              <option value="">Walk-in customer</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.loyaltyPoints} points</option>)}
            </select>
          </label>
          {lines.length ? (
            <div className="pos-cart-lines">
              {lines.map((line) => {
                const product = productById.get(line.variantId);
                if (!product) return null;
                return (
                  <div className="pos-cart-line" key={line.variantId}>
                    <span><strong>{product.name}</strong><small>{product.sku} · {currency} {Number(product.price).toFixed(2)} each · {TAX_TREATMENT_LABELS[product.taxTreatment]}</small></span>
                    <label className="visually-hidden" htmlFor={`pos-quantity-${line.variantId}`}>Quantity for {product.name}</label>
                    <input id={`pos-quantity-${line.variantId}`} type="number" min="1" max={product.available ?? 1000000} step="1" value={line.quantity} onChange={(event) => setLines((current) => current.map((item) => item.variantId === line.variantId ? { ...item, quantity: Number(event.target.value) } : item))} />
                    <button className="pos-remove-line" type="button" onClick={() => setLines((current) => current.filter((item) => item.variantId !== line.variantId))} aria-label={`Remove ${product.name}`}>Remove</button>
                  </div>
                );
              })}
            </div>
          ) : <p className="report-empty">Add a product to start a cart.</p>}
          <label>
            Promotion code <span className="optional-label">Optional</span>
            <input
              name="promotionCode"
              maxLength={32}
              value={promotionCode}
              onChange={(event) => {
                const nextCode = event.target.value.toUpperCase();
                setPromotionCode(nextCode);
                if (nextCode.trim()) {
                  setDiscountTotal("0");
                  setLoyaltyPointsRedeemed(0);
                }
              }}
              placeholder="Enter offer code"
              autoCapitalize="characters"
              disabled={loyaltyPointsRedeemed > 0 || Number(discountTotal) > 0}
            />
            {selectedPromotion && !totalsError && <small className="table-secondary">{selectedPromotion.name} applied</small>}
          </label>
          <label>
            Discount ({currency}) {canDiscount ? "" : <span className="optional-label">Owner/manager only</span>}
            <input name="discountTotal" type="number" min="0" max={totals?.subtotal ?? 0} step="0.01" value={promotionCode.trim() || loyaltyPointsRedeemed > 0 ? "0" : discountTotal} onChange={(event) => {
              setDiscountTotal(event.target.value);
              if (Number(event.target.value) > 0) {
                setPromotionCode("");
                setLoyaltyPointsRedeemed(0);
              }
            }} disabled={!canDiscount || Boolean(promotionCode.trim()) || loyaltyPointsRedeemed > 0} />
          </label>
          <label>
            Redeem loyalty points {selectedCustomer ? <span className="optional-label">{selectedCustomer.loyaltyPoints} available · 100 points = {currency} 1</span> : <span className="optional-label">Select a customer first</span>}
            <input
              name="loyaltyPointsRedeemed"
              type="number"
              min="0"
              max={Math.max(0, selectedCustomer?.loyaltyPoints ?? 0)}
              step="1"
              value={loyaltyPointsRedeemed}
              onChange={(event) => {
                const points = Number(event.target.value);
                setLoyaltyPointsRedeemed(points);
                if (points > 0) {
                  setDiscountTotal("0");
                  setPromotionCode("");
                }
              }}
              disabled={!selectedCustomer || Boolean(promotionCode.trim()) || Number(discountTotal) > 0}
            />
          </label>
          <label>
            Apply gift card <span className="optional-label">Optional · gift card covers up to the remaining sale total</span>
            <input
              name="giftCardCode"
              type="password"
              autoComplete="off"
              value={giftCardCode}
              onChange={(event) => {
                setGiftCardCode(event.target.value.toUpperCase());
                if (event.target.value) {
                  setGiftCardId("");
                  setGiftCardLastFour(null);
                  setGiftCardRedeemed("0.00");
                }
              }}
              placeholder="Enter gift card code"
            />
            {giftCardId && giftCardLastFour && (
              <small className="gift-card-pos-summary">
                Card ending {giftCardLastFour} · {currency} {Number(giftCardRedeemed).toFixed(2)} applied
                <button className="button-quiet" type="button" onClick={() => {
                  setGiftCardId("");
                  setGiftCardLastFour(null);
                  setGiftCardRedeemed("0.00");
                }}>Remove</button>
              </small>
            )}
          </label>
          <label>
            Sale note <span className="optional-label">Optional</span>
            <input name="notes" type="text" maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          {totals && (
            <dl className="pos-totals">
              <div><dt>Subtotal</dt><dd>{formatGhanaCedis(totals.subtotal)}</dd></div>
              <div><dt>Discount</dt><dd>−{formatGhanaCedis(totals.discountTotal)}</dd></div>
              <div><dt>VAT ({totals.rates.vat}%)</dt><dd>{formatGhanaCedis(totals.vatTotal)}</dd></div>
              <div><dt>NHIL ({totals.rates.nhil}%)</dt><dd>{formatGhanaCedis(totals.nhilTotal)}</dd></div>
              <div><dt>GETFund ({totals.rates.getfund}%)</dt><dd>{formatGhanaCedis(totals.getfundTotal)}</dd></div>
              <div><dt>Total tax</dt><dd>{formatGhanaCedis(totals.taxTotal)}</dd></div>
              {selectedCustomer && totals.total && <div><dt>Points earned on payment</dt><dd>{loyaltyPointsEarned(totals.total)}</dd></div>}
              <div className="pos-total-due"><dt>Total due</dt><dd>{formatGhanaCedis(totals.total)}</dd></div>
            </dl>
          )}
          {totalsError && <p className="form-error" role="alert">{totalsError}</p>}
          {draftState.message && <p className={draftState.status === "error" ? "form-error" : "form-success"} role={draftState.status === "error" ? "alert" : "status"}>{draftState.message}</p>}
          <button className="button-primary" type="submit" disabled={saving || isOnline !== true || !localCartReady || localCartConflict || needsServerReload || !lines.length || Boolean(totalsError)}>{saving ? "Saving cart..." : recoveredLocalCart ? "Sync local cart as held cart" : initialDraft && hasUnsyncedLocalCart ? "Sync local cart changes" : effectiveOrderId ? "Update held cart" : "Save as held cart"}</button>
          {hasUnsyncedLocalCart && <button className="button-quiet" type="button" onClick={discardLocalCart}>Discard unsynced cart changes</button>}
          {localCartConflict && !hasUnsyncedLocalCart && <button className="button-quiet" type="button" onClick={discardLocalCart}>Discard local cart changes</button>}
        </form>

        {effectiveOrderId && (
          <form
            action={checkoutAction}
            className="pos-checkout-form"
            onSubmit={(event) => {
              if (isOnline !== true || hasUnsyncedLocalCart || localCartConflict || needsServerReload) {
                event.preventDefault();
                setLocalCartMessage(isOnline !== true
                  ? "Reconnect before completing checkout. No payment has been recorded."
                  : localCartConflict || needsServerReload
                    ? "Reload the latest server cart before checkout."
                    : "Sync local cart changes to the server-held cart before checkout.");
              }
            }}
          >
            <input type="hidden" name="orderId" value={effectiveOrderId} />
            <label>Cash received ({currency})<input key={cashDue.toFixed(2)} name="cashReceived" type="number" min={cashDue.toFixed(2)} step="0.01" defaultValue={cashDue.toFixed(2)} required /></label>
            {Number(giftCardRedeemed) > 0 && <p className="gift-card-pos-cash-due">Gift card applied: {currency} {Number(giftCardRedeemed).toFixed(2)} · Cash remaining: {currency} {cashDue.toFixed(2)}</p>}
            {checkoutState.message && <p className={checkoutState.status === "error" ? "form-error" : "form-success"} role={checkoutState.status === "error" ? "alert" : "status"}>{checkoutState.message}</p>}
            {checkoutState.receiptHref
              ? <Link className="button-primary" href={checkoutState.receiptHref}>Open sale receipt</Link>
              : <button className="button-primary" type="submit" disabled={checkingOut || isOnline !== true || hasUnsyncedLocalCart || localCartConflict || needsServerReload}>{checkingOut ? "Completing sale..." : "Complete sale"}</button>}
          </form>
        )}
      </section>
    </div>
  );
}
