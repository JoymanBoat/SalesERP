export const TAX_TREATMENTS = ["STANDARD", "ZERO_RATED", "EXEMPT", "RELIEVED"] as const;
export type TaxTreatmentValue = (typeof TAX_TREATMENTS)[number];
export const TAX_COMPONENTS = ["VAT", "NHIL", "GETFUND"] as const;
export type TaxComponentValue = (typeof TAX_COMPONENTS)[number];

export type TaxRates = { vat: string; nhil: string; getfund: string };
export const ZERO_TAX_RATES: TaxRates = { vat: "0.00", nhil: "0.00", getfund: "0.00" };

export const GRA_TAX_INFORMATION_URL = "https://gra.gov.gh/domestic-tax/tax-types/vat/";
export const TAX_DISCLAIMER =
  `Tax rates and product treatments are configurable settings only. They are not tax advice and do not establish compliance. Confirm current rates, effective dates and treatments with the Ghana Revenue Authority (${GRA_TAX_INFORMATION_URL}) or a qualified adviser.`;

export const TAX_TREATMENT_LABELS: Record<TaxTreatmentValue, string> = {
  STANDARD: "Standard",
  ZERO_RATED: "Zero-rated",
  EXEMPT: "Exempt",
  RELIEVED: "Relieved",
};

export function isTaxTreatment(value: unknown): value is TaxTreatmentValue {
  return typeof value === "string" && (TAX_TREATMENTS as readonly string[]).includes(value);
}

export type TaxRateHistoryEntry = { component: TaxComponentValue; rate: string; effectiveFrom: string };

/** Picks, per component, the latest rate whose effective date is on or before the business date. */
export function resolveTaxRatesAt(history: TaxRateHistoryEntry[], businessDate: string): TaxRates {
  const pick = (component: TaxComponentValue) => {
    const applicable = history
      .filter((entry) => entry.component === component && entry.effectiveFrom <= businessDate)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    return applicable[0]?.rate ?? "0.00";
  };
  return { vat: pick("VAT"), nhil: pick("NHIL"), getfund: pick("GETFUND") };
}

export function sumTaxRates(rates: TaxRates) {
  const cents = [rates.vat, rates.nhil, rates.getfund].reduce((total, rate) => {
    const [whole, fraction = ""] = rate.split(".");
    return total + Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  }, 0);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}