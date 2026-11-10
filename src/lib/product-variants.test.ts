import { describe, expect, it } from "vitest";

import {
  productOptionSchema,
  productVariantDeleteSchema,
  productVariantInputSchema,
} from "./validation";

describe("product variant deletion input", () => {
  it("requires a valid product and variant identifier", () => {
    expect(productVariantDeleteSchema.safeParse({
      productId: "clh1p2s3t0000qwertyuiopas",
      variantId: "clh1p2s3t0001qwertyuiopas",
    }).success).toBe(true);
    expect(productVariantDeleteSchema.safeParse({
      productId: "invalid",
      variantId: "clh1p2s3t0001qwertyuiopas",
    }).success).toBe(false);
    expect(productVariantDeleteSchema.safeParse({
      productId: "clh1p2s3t0000qwertyuiopas",
      variantId: "",
    }).success).toBe(false);
  });

  it("normalizes reusable option names and validates unique variant option assignments", () => {
    const optionId = "clh1p2s3t0002qwertyuiopas";
    const productId = "clh1p2s3t0000qwertyuiopas";
    expect(productOptionSchema.safeParse({ name: "  Sleeve   Length " })).toMatchObject({
      success: true,
      data: { name: "Sleeve Length" },
    });
    expect(productOptionSchema.safeParse({ name: " " }).success).toBe(false);

    const variant = {
      productId,
      name: "Long sleeve",
      sku: "SHIRT-LS",
      unitPrice: "12.00",
      initialStock: 0,
      reorderPoint: 0,
      optionValues: [{ optionId, value: "Long" }],
    };
    expect(productVariantInputSchema.safeParse(variant).success).toBe(true);
    expect(productVariantInputSchema.safeParse({
      ...variant,
      optionValues: [{ optionId, value: "Long" }, { optionId, value: "Short" }],
    }).success).toBe(false);
    expect(productVariantInputSchema.safeParse({
      ...variant,
      optionValues: [{ optionId: "invalid", value: "Long" }],
    }).success).toBe(false);
  });
});
