import { describe, expect, it } from "vitest";
import { MembershipRole } from "@prisma/client";

import { canManagePricing } from "./permissions";
import { appendGiftCardTransactionCsvRows, buildGiftCardBalanceCsv, buildGiftCardTransactionsCsv, createGiftCardTransactionCsvAccumulator, giftCardTransactionCsvFooter, giftCardTransactionCsvHeader, generateGiftCardCode, giftCardExpiryIsValid, giftCardRefundCents, giftCardTenderCents, hashGiftCardCode, normalizeGiftCardCode } from "./gift-cards";
import { availableInventoryQuantity, businessDateInTimeZone, calculatePromotionDiscount, calculateSaleTotals, canReserveInventoryQuantity, eligiblePromotionSubtotal, findUniqueBarcodeMatch, loyaltyPointsDiscount, loyaltyPointsEarned, proratedLoyaltyPoints, promotionIsWithinDates, promotionMeetsMinimumSubtotal, returnedLineRefundCents } from "./pos";
import { ZERO_TAX_RATES } from "./tax";
import { cashCheckoutSchema, giftCardIssueSchema, inventoryReorderPointSchema, offlineCartSnapshotSchema, promotionInputSchema, promotionStatusSchema, refundSchema, saleDraftSchema, saleReturnSchema, taxSettingsSchema } from "./validation";

describe("POS sale totals", () => {
  it("validates bounded per-store inventory reorder point updates", () => {
    const variantId = "clxxxxxxxxxxxxxxxxxxxxxxxxx";
    expect(inventoryReorderPointSchema.safeParse({
      variantId,
      expectedReorderPoint: "5",
      reorderPoint: "12",
    }).success).toBe(true);
    expect(inventoryReorderPointSchema.safeParse({
      variantId,
      expectedReorderPoint: "5.5",
      reorderPoint: "12",
    }).success).toBe(false);
    expect(inventoryReorderPointSchema.safeParse({
      variantId,
      expectedReorderPoint: "5",
      reorderPoint: "1000001",
    }).success).toBe(false);
  });

  it("matches a scanned barcode only when it uniquely identifies an active variant", () => {
    const products = [
      { id: "one", barcode: " 0123456789 " },
      { id: "two", barcode: "ABC-123" },
      { id: "three", barcode: null },
    ];
    expect(findUniqueBarcodeMatch(products, "0123456789")?.id).toBe("one");
    expect(findUniqueBarcodeMatch(products, " abc-123 ")?.id).toBe("two");
    expect(findUniqueBarcodeMatch(products, "")).toBeNull();
    expect(findUniqueBarcodeMatch(products, "missing")).toBeNull();
    expect(findUniqueBarcodeMatch([...products, { id: "duplicate", barcode: "0123456789" }], "0123456789")).toBeNull();
  });

  it("credits a held cart's own reservation when calculating available stock", () => {
    expect(availableInventoryQuantity(10, 7)).toBe(3);
    expect(availableInventoryQuantity(10, 7, 5)).toBe(8);
    expect(availableInventoryQuantity(2, 5)).toBe(0);
    expect(canReserveInventoryQuantity(10, 7, 8, 5)).toBe(true);
    expect(canReserveInventoryQuantity(10, 7, 9, 5)).toBe(false);
  });

  it("allocates discount and rounds tax in cents", () => {
    const totals = calculateSaleTotals([
      { variantId: "a", quantity: 1, unitPrice: "10.00" },
      { variantId: "b", quantity: 2, unitPrice: "5.00" },
    ], "1.00", { vat: "10.00", nhil: "0.00", getfund: "0.00" });

    expect(totals).toMatchObject({
      subtotal: "20.00",
      discountTotal: "1.00",
      taxTotal: "1.90",
      vatTotal: "1.90",
      taxRate: "10.00",
      total: "20.90",
    });
    expect(totals.lines.map(({ discountAmount, taxAmount, lineTotal }) => [discountAmount, taxAmount, lineTotal])).toEqual([
      ["0.50", "0.95", "10.45"],
      ["0.50", "0.95", "10.45"],
    ]);
  });

  it("applies each tax component to the same discounted base without cascading", () => {
    const totals = calculateSaleTotals(
      [{ variantId: "a", quantity: 1, unitPrice: "100.00" }],
      "10.00",
      { vat: "15.00", nhil: "2.50", getfund: "2.50" },
    );
    expect(totals.vatTotal).toBe("13.50");
    expect(totals.nhilTotal).toBe("2.25");
    expect(totals.getfundTotal).toBe("2.25");
    expect(totals.taxTotal).toBe("18.00");
    expect(totals.total).toBe("108.00");
  });

  it("yields zero tax for non-standard treatments and keeps the treatment on each line", () => {
    const rates = { vat: "15.00", nhil: "2.50", getfund: "2.50" };
    const totals = calculateSaleTotals([
      { variantId: "s", quantity: 1, unitPrice: "10.00" },
      { variantId: "z", quantity: 1, unitPrice: "10.00", taxTreatment: "ZERO_RATED" },
      { variantId: "e", quantity: 1, unitPrice: "10.00", taxTreatment: "EXEMPT" },
      { variantId: "r", quantity: 1, unitPrice: "10.00", taxTreatment: "RELIEVED" },
    ], "0", rates);
    expect(totals.lines.map((line) => [line.taxTreatment, line.taxAmount])).toEqual([
      ["STANDARD", "2.00"], ["ZERO_RATED", "0.00"], ["EXEMPT", "0.00"], ["RELIEVED", "0.00"],
    ]);
    expect(totals.taxTotal).toBe("2.00");
  });

  it("defaults to zero tax when no rates are configured", () => {
    const totals = calculateSaleTotals([{ variantId: "a", quantity: 1, unitPrice: "10.00" }], "0", ZERO_TAX_RATES);
    expect(totals.taxTotal).toBe("0.00");
    expect(totals.taxRate).toBe("0.00");
  });

  it("rejects discounts beyond subtotal and unsupported tax rates", () => {
    const line = [{ variantId: "a", quantity: 1, unitPrice: "10.00" }];
    expect(() => calculateSaleTotals(line, "10.01", ZERO_TAX_RATES)).toThrow(RangeError);
    expect(() => calculateSaleTotals(line, "0", { ...ZERO_TAX_RATES, vat: "100.01" })).toThrow(RangeError);
    expect(() => calculateSaleTotals(line, "0", { vat: "60.00", nhil: "40.00", getfund: "0.01" })).toThrow(RangeError);
    const base = { effectiveFrom: "2026-11-06" };
    expect(taxSettingsSchema.safeParse({ ...base, vat: "100", nhil: "0", getfund: "0" }).success).toBe(true);
    expect(taxSettingsSchema.safeParse({ ...base, vat: "100.01", nhil: "0", getfund: "0" }).success).toBe(false);
    expect(taxSettingsSchema.safeParse({ ...base, vat: "90", nhil: "10", getfund: "1" }).success).toBe(false);
  });

  it("calculates fixed and percentage promotion discounts in cents", () => {
    expect(calculatePromotionDiscount("19.99", "PERCENTAGE", "12.5")).toBe("2.50");
    expect(calculatePromotionDiscount("19.99", "FIXED", "25")).toBe("19.99");
    expect(() => calculatePromotionDiscount("19.99", "PERCENTAGE", "100.01")).toThrow(RangeError);
  });

  it("allocates product-scoped promotion discounts only to eligible lines", () => {
    const lines = [
      { variantId: "eligible-a", quantity: 1, unitPrice: "10.00" },
      { variantId: "excluded", quantity: 1, unitPrice: "20.00" },
      { variantId: "eligible-b", quantity: 1, unitPrice: "10.00" },
    ];
    const eligibleSubtotal = eligiblePromotionSubtotal(lines, ["eligible-a", "eligible-b"]);
    expect(eligibleSubtotal).toBe("20.00");
    expect(calculatePromotionDiscount(eligibleSubtotal, "PERCENTAGE", "10")).toBe("2.00");
    const totals = calculateSaleTotals(lines, "2.00", ZERO_TAX_RATES, ["eligible-a", "eligible-b"]);
    expect(totals.discountTotal).toBe("2.00");
    expect(totals.lines.map(({ discountAmount }) => discountAmount)).toEqual(["1.00", "0.00", "1.00"]);
    expect(() => calculateSaleTotals(lines, "20.01", ZERO_TAX_RATES, ["eligible-a", "eligible-b"])).toThrow(RangeError);
  });

  it("checks promotion minimums and inclusive schedule dates in the business timezone", () => {
    const now = new Date("2026-11-05T23:30:00.000Z");
    const businessDate = businessDateInTimeZone(now, "Africa/Accra");
    expect(businessDate).toBe("2026-11-05");
    expect(promotionIsWithinDates("2026-11-05", "2026-11-05", businessDate)).toBe(true);
    expect(promotionIsWithinDates("2026-11-06", null, businessDate)).toBe(false);
    expect(promotionIsWithinDates(null, "2026-11-04", businessDate)).toBe(false);
    expect(promotionIsWithinDates("2026-99-99", null, businessDate)).toBe(false);
    expect(promotionIsWithinDates(null, "2026-11-30", "2026-02-30")).toBe(false);
    expect(promotionMeetsMinimumSubtotal("20.00", "20.00")).toBe(true);
    expect(promotionMeetsMinimumSubtotal("19.99", "20.00")).toBe(false);
  });

  it("converts loyalty points to cents and earns points per full paid GHS", () => {
    expect(loyaltyPointsDiscount(100)).toBe("1.00");
    expect(loyaltyPointsDiscount(1)).toBe("0.01");
    expect(loyaltyPointsEarned("10.99")).toBe(10);
    expect(loyaltyPointsEarned("0.99")).toBe(0);
    expect(() => loyaltyPointsDiscount(-1)).toThrow(RangeError);
  });

  it("prorates point reversal across partial refunds without losing points", () => {
    expect(proratedLoyaltyPoints(101, 333n, 1000n)).toBe(33);
    expect(proratedLoyaltyPoints(101, 667n, 1000n)).toBe(67);
    expect(proratedLoyaltyPoints(101, 1000n, 1000n)).toBe(101);
  });

  it("allocates line refunds without losing cents across partial returns", () => {
    expect(returnedLineRefundCents(1000n, 3, 0, 1)).toBe(333n);
    expect(returnedLineRefundCents(1000n, 3, 1, 1)).toBe(333n);
    expect(returnedLineRefundCents(1000n, 3, 2, 1)).toBe(334n);
    expect(() => returnedLineRefundCents(1000n, 3, 2, 2)).toThrow(RangeError);
  });

  it("normalizes gift card codes and stores only a deterministic hash", () => {
    const issued = generateGiftCardCode();
    expect(issued.code).toMatch(/^KR(?:-[A-F0-9]{6}){4}$/);
    expect(normalizeGiftCardCode(issued.code)).toMatch(/^KR[A-F0-9]{24}$/);
    expect(hashGiftCardCode(issued.code)).toBe(issued.codeHash);
    expect(() => hashGiftCardCode("not-a-card")).toThrow(RangeError);
  });

  it("allocates available card tender and prorates refunds without losing cents", () => {
    expect(giftCardTenderCents(2500n, 4000n)).toBe(2500n);
    expect(giftCardTenderCents(5000n, 4000n)).toBe(4000n);
    expect(giftCardRefundCents(333n, 1000n, 3000n)).toBe(111n);
    expect(giftCardRefundCents(3000n, 1000n, 3000n)).toBe(1000n);
    expect(() => giftCardRefundCents(4000n, 1000n, 3000n)).toThrow(RangeError);
  });

  it("allows gift card expiry on the business date but rejects earlier dates", () => {
    expect(giftCardExpiryIsValid("2026-11-05", "2026-11-05")).toBe(true);
    expect(giftCardExpiryIsValid("2026-11-06", "2026-11-05")).toBe(true);
    expect(giftCardExpiryIsValid("2026-11-04", "2026-11-05")).toBe(false);
    expect(giftCardExpiryIsValid("2026-99-99", "2026-11-05")).toBe(false);
    expect(giftCardExpiryIsValid("2026-11-06", "2026-02-30")).toBe(false);
    expect(giftCardExpiryIsValid(null, "2026-11-05")).toBe(true);
  });

  it("exports masked gift card balances with exact totals and formula-safe fields", () => {
    const csv = buildGiftCardBalanceCsv([
      {
        codeLastFour: "0123",
        issuedAt: "Nov 5, 2026, 8:00 PM",
        expiresOn: null,
        status: "=HYPERLINK(\"https://example.com\")",
        initialBalance: "10.10",
        balance: "8.05",
      },
      {
        codeLastFour: "5678",
        issuedAt: "Nov 5, 2026, 8:05 PM",
        expiresOn: "2027-01-01",
        status: "Inactive",
        initialBalance: "0.20",
        balance: "0.10",
      },
    ], "GHS", "2026-11-05");

    expect(csv).toContain('"As of business date","2026-11-05","Currency","GHS"');
    expect(csv).toContain('"•••• 0123"');
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"TOTAL","","","","10.30","8.15","GHS"');
    expect(csv).not.toContain("codeHash");
  });

  it("exports the masked gift card transaction ledger with exact event totals", () => {
    const transactions = [
      { id: "issue", cardId: "card-1", codeLastFour: "0123", recordedAt: "Nov 5, 2026, 8:00 PM", createdBy: "Manager", type: "ISSUE", amountDelta: "20.00", orderNumber: null },
      { id: "other-issue", cardId: "card-2", codeLastFour: "9876", recordedAt: "Nov 5, 2026, 8:02 PM", createdBy: "Owner", type: "ISSUE", amountDelta: "5.00", orderNumber: null },
      { id: "redeem", cardId: "card-1", codeLastFour: "0123", recordedAt: "Nov 5, 2026, 8:05 PM", createdBy: "Cashier", type: "REDEEM", amountDelta: "-12.50", orderNumber: 42 },
      { id: "refund", cardId: "card-1", codeLastFour: "0123", recordedAt: "Nov 5, 2026, 8:10 PM", createdBy: "Manager", type: "REFUND", amountDelta: "2.50", orderNumber: 42 },
    ] as const;
    const csv = buildGiftCardTransactionsCsv([...transactions], "GHS", "2026-11-05");

    expect(csv).toContain('"REDEEM","•••• 0123","42","Cashier","DEBIT","12.50","7.50","GHS"');
    expect(csv).toContain('"ISSUE","•••• 9876","","Owner","CREDIT","5.00","5.00","GHS"');
    expect(csv).toContain('"REFUND","•••• 0123","42","Manager","CREDIT","2.50","10.00","GHS"');
    expect(csv).toContain('"Issued","","","","","","25.00","","GHS"');
    expect(csv).toContain('"Redeemed","","","","","","12.50","","GHS"');
    expect(csv).toContain('"Refunded","","","","","","2.50","","GHS"');
    expect(csv).not.toContain("codeHash");
  });

  it("preserves running balances and totals across CSV batches", () => {
    const transactions = [
      { id: "issue", cardId: "card-1", codeLastFour: "0123", recordedAt: "Nov 5, 2026, 8:00 PM", createdBy: "Manager", type: "ISSUE" as const, amountDelta: "20.00", orderNumber: null },
      { id: "redeem", cardId: "card-1", codeLastFour: "0123", recordedAt: "Nov 5, 2026, 8:05 PM", createdBy: "Cashier", type: "REDEEM" as const, amountDelta: "-12.50", orderNumber: 42 },
      { id: "refund", cardId: "card-1", codeLastFour: "0123", recordedAt: "Nov 5, 2026, 8:10 PM", createdBy: "Manager", type: "REFUND" as const, amountDelta: "2.50", orderNumber: 42 },
    ];
    const accumulator = createGiftCardTransactionCsvAccumulator();
    const batchedCsv = `${giftCardTransactionCsvHeader("GHS", "2026-11-05")}${appendGiftCardTransactionCsvRows(transactions.slice(0, 1), accumulator, "GHS")}${appendGiftCardTransactionCsvRows(transactions.slice(1), accumulator, "GHS")}${giftCardTransactionCsvFooter(accumulator, "GHS")}`;

    expect(batchedCsv).toBe(buildGiftCardTransactionsCsv(transactions, "GHS", "2026-11-05"));
    expect(batchedCsv).toContain('"REDEEM","•••• 0123","42","Cashier","DEBIT","12.50","7.50","GHS"');
  });

  it("exports an empty gift card transaction ledger with zero totals", () => {
    const csv = buildGiftCardTransactionsCsv([], "GHS", "2026-11-05");

    expect(csv).toContain('"TOTAL BY EVENT","","","","","","","",""');
    expect(csv).toContain('"Issued","","","","","","0.00","","GHS"');
    expect(csv).toContain('"Redeemed","","","","","","0.00","","GHS"');
    expect(csv).toContain('"Refunded","","","","","","0.00","","GHS"');
  });
});

describe("POS authorization and input validation", () => {
  const orderId = "clh1p2s3t0000qwertyuiopas";
  const itemId = "clh1p2s3t0001qwertyuiopas";

  it("allows only owners and managers to manage pricing", () => {
    expect(canManagePricing(MembershipRole.OWNER)).toBe(true);
    expect(canManagePricing(MembershipRole.MANAGER)).toBe(true);
    expect(canManagePricing(MembershipRole.CASHIER)).toBe(false);
    expect(canManagePricing(MembershipRole.ACCOUNTANT)).toBe(false);
  });

  it("accepts zero cash for a fully discounted sale and rejects short tender in checkout", () => {
    expect(cashCheckoutSchema.safeParse({ orderId, cashReceived: "0" }).success).toBe(true);
    expect(cashCheckoutSchema.safeParse({ orderId, cashReceived: "-1" }).success).toBe(false);
    expect(cashCheckoutSchema.safeParse({ orderId: "invalid", cashReceived: "10" }).success).toBe(false);
  });

  it("validates a bounded offline cart snapshot without storing tender or customer details", () => {
    const snapshot = {
      version: 1,
      savedAt: "2026-11-05T12:00:00.000Z",
      lines: [{ variantId: itemId, quantity: 2 }],
    };
    expect(offlineCartSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(offlineCartSnapshotSchema.safeParse({
      ...snapshot,
      lines: [...snapshot.lines, ...snapshot.lines],
    }).success).toBe(false);
    expect(offlineCartSnapshotSchema.safeParse({
      ...snapshot,
      lines: [{ variantId: itemId, quantity: 0 }],
    }).success).toBe(false);
    expect(offlineCartSnapshotSchema.safeParse({
      ...snapshot,
      version: 2,
    }).success).toBe(false);
    expect(offlineCartSnapshotSchema.safeParse({
      ...snapshot,
      expectedUpdatedAt: "not-a-timestamp",
    }).success).toBe(false);
    expect(saleDraftSchema.safeParse({
      orderId,
      lines: [{ variantId: itemId, quantity: 1 }],
    }).success).toBe(false);
    expect(saleDraftSchema.safeParse({
      orderId,
      expectedUpdatedAt: snapshot.savedAt,
      lines: [{ variantId: itemId, quantity: 1 }],
    }).success).toBe(true);
  });

  it("requires positive, bounded cash refunds and valid return lines", () => {
    const key = "123e4567-e89b-42d3-a456-426614174000";
    expect(refundSchema.safeParse({ orderId, amount: "12.50", reason: "Customer request", idempotencyKey: key }).success).toBe(true);
    expect(refundSchema.safeParse({ orderId, amount: "0", reason: "Customer request", idempotencyKey: key }).success).toBe(false);
    expect(saleReturnSchema.safeParse({
      orderId,
      reason: "Incorrect size",
      idempotencyKey: key,
      lines: [{ itemId, quantity: 1, restock: true }],
    }).success).toBe(true);
    expect(saleReturnSchema.safeParse({
      orderId,
      reason: "x",
      idempotencyKey: key,
      lines: [{ itemId, quantity: 0, restock: true }],
    }).success).toBe(false);
  });

  it("normalizes promotion codes, enforces promotion limits, and rejects mixed discounts", () => {
    const promotion = promotionInputSchema.safeParse({
      name: "Weekend offer",
      code: "weekend_10",
      type: "PERCENTAGE",
      value: "10",
      maxRedemptions: "20",
    });
    expect(promotion.success && promotion.data.code).toBe("WEEKEND_10");
    expect(promotionInputSchema.safeParse({
      name: "Too much",
      code: "TOO-MUCH",
      type: "PERCENTAGE",
      value: "100.01",
      maxRedemptions: "",
    }).success).toBe(false);
    expect(saleDraftSchema.safeParse({
      lines: [{ variantId: "clh1p2s3t0000qwertyuiopas", quantity: 1 }],
      discountTotal: "1",
      promotionCode: "SAVE10",
    }).success).toBe(false);
    expect(saleDraftSchema.safeParse({
      customerId: orderId,
      loyaltyPointsRedeemed: "100",
      lines: [{ variantId: itemId, quantity: 1 }],
    }).success).toBe(true);
    expect(saleDraftSchema.safeParse({
      loyaltyPointsRedeemed: "100",
      lines: [{ variantId: itemId, quantity: 1 }],
    }).success).toBe(false);
    const datedPromotion = promotionInputSchema.safeParse({
      name: "Dated deal",
      code: "DATED",
      type: "FIXED",
      value: "5",
      minimumSubtotal: "50",
      startsOn: "2026-11-10",
      endsOn: "2026-11-09",
      maxRedemptions: "",
    });
    expect(datedPromotion.success).toBe(false);
    expect(promotionInputSchema.safeParse({
      name: "Invalid date",
      code: "INVALID",
      type: "FIXED",
      value: "5",
      startsOn: "2026-02-30",
      endsOn: "",
      maxRedemptions: "",
    }).success).toBe(false);
    expect(promotionInputSchema.safeParse({
      name: "Product deal",
      code: "PRODUCT_DEAL",
      type: "FIXED",
      value: "5",
      productIds: [itemId, itemId],
    }).success).toBe(false);
    expect(promotionStatusSchema.safeParse({ promotionId: orderId, active: "false" }).success).toBe(true);
  });

  it("validates positive gift card issue amounts and optional calendar expiry", () => {
    expect(giftCardIssueSchema.safeParse({ amount: "50.00", expiresOn: "2027-12-31" }).success).toBe(true);
    expect(giftCardIssueSchema.safeParse({ amount: "0", expiresOn: "" }).success).toBe(false);
    expect(giftCardIssueSchema.safeParse({ amount: "10", expiresOn: "2027-02-29" }).success).toBe(false);
  });
});
