import { describe, expect, it } from "vitest";

import { parseRestockQuantity, quantityToReachReorderPoint } from "./inventory";

describe("inventory replenishment quantity", () => {
  it("calculates the quantity needed to bring available stock up to the reorder point", () => {
    expect(quantityToReachReorderPoint(2, 8)).toBe(6);
    expect(quantityToReachReorderPoint(8, 8)).toBe(0);
    expect(quantityToReachReorderPoint(10, 8)).toBe(0);
    expect(quantityToReachReorderPoint(0, 5)).toBe(5);
  });

  it("rejects invalid quantities", () => {
    expect(() => quantityToReachReorderPoint(-1, 5)).toThrow(RangeError);
    expect(() => quantityToReachReorderPoint(2, -1)).toThrow(RangeError);
    expect(() => quantityToReachReorderPoint(1.5, 5)).toThrow(RangeError);
  });

  it("accepts only bounded positive purchase-order quantities from a restock link", () => {
    expect(parseRestockQuantity("5")).toBe(5);
    expect(parseRestockQuantity("1000000")).toBe(1_000_000);
    expect(parseRestockQuantity(undefined)).toBeNull();
    expect(parseRestockQuantity("0")).toBeNull();
    expect(parseRestockQuantity("-2")).toBeNull();
    expect(parseRestockQuantity("1.5")).toBeNull();
    expect(parseRestockQuantity("1000001")).toBeNull();
  });
});
