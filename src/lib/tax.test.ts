import { describe, expect, it } from "vitest";

import { productInputSchema } from "./validation";
import { GRA_TAX_INFORMATION_URL, isTaxTreatment, resolveTaxRatesAt, sumTaxRates, TAX_DISCLAIMER } from "./tax";

describe("tax configuration helpers", () => {
  it("defaults every component to zero before configuration", () => {
    expect(resolveTaxRatesAt([], "2026-11-06")).toEqual({ vat: "0.00", nhil: "0.00", getfund: "0.00" });
  });

  it("selects the latest rate effective on or before the business date per component", () => {
    const history = [
      { component: "VAT" as const, rate: "12.50", effectiveFrom: "2026-01-01" },
      { component: "VAT" as const, rate: "15.00", effectiveFrom: "2026-11-10" },
      { component: "NHIL" as const, rate: "2.50", effectiveFrom: "2026-02-01" },
    ];
    expect(resolveTaxRatesAt(history, "2026-11-09")).toEqual({ vat: "12.50", nhil: "2.50", getfund: "0.00" });
    expect(resolveTaxRatesAt(history, "2026-11-10").vat).toBe("15.00");
    expect(resolveTaxRatesAt(history, "2025-12-31").vat).toBe("0.00");
  });

  it("sums component rates and validates treatments", () => {
    expect(sumTaxRates({ vat: "15.00", nhil: "2.50", getfund: "2.50" })).toBe("20.00");
    expect(isTaxTreatment("RELIEVED")).toBe(true);
    expect(isTaxTreatment("OTHER")).toBe(false);
  });

  it("accepts only known product tax treatments and defaults to standard", () => {
    const base = { name: "Tea", sku: "TEA-1", unitPrice: "1.00", initialStock: 0, reorderPoint: 0 };
    expect(productInputSchema.parse(base).taxTreatment).toBe("STANDARD");
    expect(productInputSchema.parse({ ...base, taxTreatment: "RELIEVED" }).taxTreatment).toBe("RELIEVED");
    expect(productInputSchema.safeParse({ ...base, taxTreatment: "NONE" }).success).toBe(false);
  });

  it("states configurability is not advice and cites the GRA", () => {
    expect(TAX_DISCLAIMER).toContain("not tax advice");
    expect(TAX_DISCLAIMER).toContain(GRA_TAX_INFORMATION_URL);
    expect(GRA_TAX_INFORMATION_URL.startsWith("https://gra.gov.gh/")).toBe(true);
  });
});