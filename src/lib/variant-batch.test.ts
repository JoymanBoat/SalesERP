import { describe, expect, it } from "vitest";

import { buildVariantCombinations, variantBatchOptionsSchema, variantOptionKey } from "./variant-batch";

const first = "clh1p2s3t0001qwertyuiopas";
const second = "clh1p2s3t0002qwertyuiopas";

describe("variant batches", () => {
  it("builds and normalizes the full Cartesian product", () => {
    const parsed = variantBatchOptionsSchema.parse([
      { optionId: first, values: [" Small ", "Large"] },
      { optionId: second, values: ["Red", "Blue"] },
    ]);
    expect(buildVariantCombinations(parsed)).toHaveLength(4);
    expect(variantOptionKey([{ optionId: first, value: " SMALL " }, { optionId: second, value: "Red" }]))
      .toBe(variantOptionKey([{ optionId: second, value: "red" }, { optionId: first, value: "small" }]));
  });

  it("rejects duplicate values, duplicate options, invalid IDs, and batches over 50", () => {
    expect(variantBatchOptionsSchema.safeParse([{ optionId: first, values: ["Red", " red "] }]).success).toBe(false);
    expect(variantBatchOptionsSchema.safeParse([{ optionId: first, values: ["S"] }, { optionId: first, values: ["L"] }]).success).toBe(false);
    expect(variantBatchOptionsSchema.safeParse([{ optionId: "invalid", values: ["S"] }]).success).toBe(false);
    const values = Array.from({ length: 51 }, (_, index) => String(index));
    expect(variantBatchOptionsSchema.safeParse([{ optionId: first, values }]).success).toBe(false);
    expect(variantBatchOptionsSchema.safeParse([{ optionId: first, values: values.slice(0, 50) }]).success).toBe(true);
    expect(variantBatchOptionsSchema.safeParse([{ optionId: first, values: values.slice(0, 10) }, { optionId: second, values: values.slice(0, 6) }]).success).toBe(false);
  });
});
