"use client";

import { useActionState } from "react";

import { SUBSCRIPTION_FEATURES, type SubscriptionFeature } from "@/lib/subscription-policy";

import { updatePackage, type PackageActionState } from "./actions";

const featureLabels: Record<SubscriptionFeature, string> = {
  pos: "Point of sale",
  inventory: "Inventory",
  customers: "Customers",
  suppliers: "Suppliers",
  purchasing: "Purchasing",
  reports: "Reports",
  promotions: "Promotions",
  giftCards: "Gift cards",
};

type PackageFormProps = {
  id: string;
  name: string;
  revision: number;
  features: string[];
  maxStores: number | null;
  maxStaff: number | null;
  monthlyPrice: string | null;
  annualPrice: string | null;
};

export function PackageForm({ packageInfo }: { packageInfo: PackageFormProps }) {
  const initialState: PackageActionState = { status: "idle", message: "" };
  const [state, action, pending] = useActionState(updatePackage, initialState);
  return (
    <form action={action} className="platform-package-form">
      <input type="hidden" name="id" value={packageInfo.id} />
      <input type="hidden" name="revision" value={packageInfo.revision} />
      <div className="platform-package-fields">
        <label>Monthly price (GHS)<input name="monthlyPrice" type="number" min="0" max="9999999999.99" step="0.01" defaultValue={packageInfo.monthlyPrice ?? ""} placeholder="Not set" /></label>
        <label>Annual price (GHS)<input name="annualPrice" type="number" min="0" max="9999999999.99" step="0.01" defaultValue={packageInfo.annualPrice ?? ""} placeholder="Not set" /></label>
        <label>Maximum stores<input name="maxStores" type="number" min="1" max="100000" step="1" defaultValue={packageInfo.maxStores ?? ""} placeholder="Unlimited" /></label>
        <label>Maximum staff<input name="maxStaff" type="number" min="1" max="100000" step="1" defaultValue={packageInfo.maxStaff ?? ""} placeholder="Unlimited" /></label>
      </div>
      <fieldset><legend>Included features</legend><div className="platform-feature-grid">{SUBSCRIPTION_FEATURES.map((feature) => (
        <label key={feature}><input type="checkbox" name="features" value={feature} defaultChecked={packageInfo.features.includes(feature)} /> {featureLabels[feature]}</label>
      ))}</div></fieldset>
      <p className="platform-package-hint">Blank prices are not set. Blank limits mean unlimited.</p>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="platform-save-button" type="submit" disabled={pending}>{pending ? "Saving..." : `Save ${packageInfo.name}`}</button>
    </form>
  );
}
