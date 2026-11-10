"use client";

import { useActionState } from "react";

import { updateTaxSettings } from "@/app/pos/actions";
import type { TaxRateHistoryEntry, TaxRates } from "@/lib/tax";

const initialState = { status: "idle" as const, message: "" };

export function PosSettingsForm({
  rates,
  today,
  history,
}: {
  rates: TaxRates;
  today: string;
  history: TaxRateHistoryEntry[];
}) {
  const [state, action, pending] = useActionState(updateTaxSettings, initialState);
  const rateInput = (name: keyof TaxRates, label: string) => (
    <label>{label} rate (%)<input name={name} type="number" min="0" max="100" step="0.01" defaultValue={rates[name]} required /></label>
  );

  return (
    <>
      <form action={action} className="pos-tax-settings">
        {rateInput("vat", "VAT")}
        {rateInput("nhil", "NHIL")}
        {rateInput("getfund", "GETFund")}
        <label>Effective from<input name="effectiveFrom" type="date" defaultValue={today} required /></label>
        <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Saving..." : "Save tax rates"}</button>
        {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
      </form>
      {history.length > 0 && (
        <details>
          <summary>Rate history</summary>
          <table className="data-table">
            <thead><tr><th>Effective from</th><th>Component</th><th>Rate (%)</th></tr></thead>
            <tbody>
              {history.map((entry) => (
                <tr key={`${entry.effectiveFrom}-${entry.component}`}><td>{entry.effectiveFrom}</td><td>{entry.component}</td><td>{entry.rate}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}