import { isCalendarDate } from "./calendar-date";
import { sumTaxRates, type TaxRates, type TaxTreatmentValue } from "./tax";

export type SaleLineInput = {
  variantId: string;
  quantity: number;
  unitPrice: string;
  taxTreatment?: TaxTreatmentValue;
};

export type PricedSaleLine = {
  variantId: string;
  quantity: number;
  unitPrice: string;
  discountAmount: string;
  taxAmount: string;
  taxTreatment: TaxTreatmentValue;
  vatAmount: string;
  nhilAmount: string;
  getfundAmount: string;
  lineTotal: string;
};

export type SaleTotals = {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  vatTotal: string;
  nhilTotal: string;
  getfundTotal: string;
  taxRate: string;
  rates: TaxRates;
  total: string;
  lines: PricedSaleLine[];
};

export function findUniqueBarcodeMatch<T extends { barcode: string | null }>(products: T[], scannedBarcode: string) {
  const barcode = scannedBarcode.trim().toLocaleUpperCase();
  if (!barcode) return null;
  const matches = products.filter((product) => product.barcode?.trim().toLocaleUpperCase() === barcode);
  return matches.length === 1 ? matches[0] : null;
}

export function calculatePromotionDiscount(subtotal: string, type: "PERCENTAGE" | "FIXED", value: string) {
  const subtotalCents = amountToCents(subtotal);
  const valueCents = amountToCents(value);
  if (valueCents < 1n) throw new RangeError("Promotion value must be greater than zero.");
  if (type === "FIXED") return centsToAmount(valueCents > subtotalCents ? subtotalCents : valueCents);
  if (valueCents > 10_000n) throw new RangeError("Percentage promotions cannot exceed 100 percent.");
  const discountCents = (subtotalCents * valueCents + 5_000n) / 10_000n;
  return centsToAmount(discountCents > subtotalCents ? subtotalCents : discountCents);
}

export function businessDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (!year || !month || !day) throw new RangeError("Could not determine the business date.");
  return `${year}-${month}-${day}`;
}

export function promotionIsWithinDates(startsOn: string | null, endsOn: string | null, businessDate: string) {
  return isCalendarDate(businessDate) &&
    (!startsOn || (isCalendarDate(startsOn) && startsOn <= businessDate)) &&
    (!endsOn || (isCalendarDate(endsOn) && endsOn >= businessDate));
}

export function promotionMeetsMinimumSubtotal(subtotal: string, minimumSubtotal: string) {
  return amountToCents(subtotal) >= amountToCents(minimumSubtotal);
}

export function eligiblePromotionSubtotal(
  lines: Array<{ variantId: string; quantity: number; unitPrice: string }>,
  eligibleVariantIds: string[] | null,
) {
  const eligible = eligibleVariantIds === null
    ? lines
    : lines.filter((line) => eligibleVariantIds.includes(line.variantId));
  const cents = eligible.reduce((total, line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError("Sale quantities must be positive bounded integers.");
    }
    return total + amountToCents(line.unitPrice) * BigInt(line.quantity);
  }, 0n);
  return centsToAmount(cents);
}

export function loyaltyPointsDiscount(points: number) {
  if (!Number.isSafeInteger(points) || points < 0 || points > 1_000_000_000) {
    throw new RangeError("Loyalty points must be a non-negative bounded integer.");
  }
  return centsToAmount(BigInt(points));
}

export function loyaltyPointsEarned(amountPaid: string) {
  return Number(amountToCents(amountPaid) / 100n);
}

export function proratedLoyaltyPoints(points: number, cumulativeRefundCents: bigint, orderTotalCents: bigint) {
  if (!Number.isSafeInteger(points) || points < 0 || cumulativeRefundCents < 0n || orderTotalCents < 0n) {
    throw new RangeError("Loyalty refund values must not be negative.");
  }
  if (orderTotalCents === 0n) return points;
  const clampedRefund = cumulativeRefundCents > orderTotalCents ? orderTotalCents : cumulativeRefundCents;
  return Number(BigInt(points) * clampedRefund / orderTotalCents);
}

export function availableInventoryQuantity(onHand: number, reserved: number, ownReservation = 0) {
  return Math.max(0, onHand - reserved + ownReservation);
}

export function canReserveInventoryQuantity(onHand: number, reserved: number, requested: number, ownReservation = 0) {
  return requested <= onHand - reserved + ownReservation;
}

function amountToCents(value: string) {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) {
    throw new RangeError("Sale amounts must be non-negative with at most two decimal places.");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function centsToAmount(value: bigint) {
  const isNegative = value < 0n;
  const absoluteValue = isNegative ? -value : value;
  const whole = absoluteValue / 100n;
  const fraction = (absoluteValue % 100n).toString().padStart(2, "0");
  return `${isNegative ? "-" : ""}${whole}.${fraction}`;
}

export function calculateSaleTotals(
  lines: SaleLineInput[],
  discountInput: string,
  taxRates: TaxRates,
  discountEligibleVariantIds?: string[],
): SaleTotals {
  if (lines.length === 0 || lines.length > 100) throw new RangeError("A sale must contain between 1 and 100 lines.");
  if (new Set(lines.map((line) => line.variantId)).size !== lines.length) {
    throw new RangeError("A sale cannot contain duplicate variant lines.");
  }
  const rateBasisPoints = (["vat", "nhil", "getfund"] as const).map((component) => {
    const input = taxRates[component];
    if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(input)) {
      throw new RangeError("Tax rates must be between 0 and 100 percent.");
    }
    const basisPoints = amountToCents(input);
    if (basisPoints > 10_000n) throw new RangeError("Tax rates must be between 0 and 100 percent.");
    return basisPoints;
  });
  const [vatBasisPoints, nhilBasisPoints, getfundBasisPoints] = rateBasisPoints;
  if (vatBasisPoints + nhilBasisPoints + getfundBasisPoints > 10_000n) {
    throw new RangeError("Combined tax rates cannot exceed 100 percent.");
  }

  const grossLines = lines.map((line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 1_000_000) {
      throw new RangeError("Sale quantities must be positive bounded integers.");
    }
    const unitPriceCents = amountToCents(line.unitPrice);
    if (unitPriceCents < 1n) throw new RangeError("Sale prices must be greater than zero.");
    return { ...line, grossCents: unitPriceCents * BigInt(line.quantity) };
  });
  const subtotalCents = grossLines.reduce((sum, line) => sum + line.grossCents, 0n);
  const discountCents = amountToCents(discountInput);
  const discountEligible = discountEligibleVariantIds === undefined
    ? grossLines
    : grossLines.filter((line) => discountEligibleVariantIds.includes(line.variantId));
  const eligibleSubtotalCents = discountEligible.reduce((sum, line) => sum + line.grossCents, 0n);
  if (discountCents > eligibleSubtotalCents) throw new RangeError("Discount cannot exceed the eligible subtotal.");

  let allocatedDiscount = 0n;
  const lastEligibleLine = discountEligible.at(-1)?.variantId;
  const pricedLines = grossLines.map((line) => {
    const isEligible = discountEligibleVariantIds === undefined || discountEligibleVariantIds.includes(line.variantId);
    const lineDiscount = !isEligible
      ? 0n
      : line.variantId === lastEligibleLine
      ? discountCents - allocatedDiscount
      : eligibleSubtotalCents === 0n ? 0n : discountCents * line.grossCents / eligibleSubtotalCents;
    allocatedDiscount += lineDiscount;
    const taxableCents = line.grossCents - lineDiscount;
    const treatment = line.taxTreatment ?? "STANDARD";
    // Every component uses the same discounted base; components are never compounded.
    const component = (basisPoints: bigint) =>
      treatment === "STANDARD" ? (taxableCents * basisPoints + 5_000n) / 10_000n : 0n;
    const vat = component(vatBasisPoints);
    const nhil = component(nhilBasisPoints);
    const getfund = component(getfundBasisPoints);
    const lineTax = vat + nhil + getfund;
    return {
      taxTreatment: treatment,
      vatAmount: vat,
      nhilAmount: nhil,
      getfundAmount: getfund,
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: lineDiscount,
      taxAmount: lineTax,
      lineTotal: taxableCents + lineTax,
    };
  });
  const taxCents = pricedLines.reduce((sum, line) => sum + line.taxAmount, 0n);
  const sumOf = (key: "vatAmount" | "nhilAmount" | "getfundAmount") =>
    centsToAmount(pricedLines.reduce((sum, line) => sum + line[key], 0n));
  const totalCents = subtotalCents - discountCents + taxCents;

  return {
    subtotal: centsToAmount(subtotalCents),
    discountTotal: centsToAmount(discountCents),
    taxTotal: centsToAmount(taxCents),
    vatTotal: sumOf("vatAmount"),
    nhilTotal: sumOf("nhilAmount"),
    getfundTotal: sumOf("getfundAmount"),
    taxRate: sumTaxRates(taxRates),
    rates: { vat: centsToAmount(vatBasisPoints), nhil: centsToAmount(nhilBasisPoints), getfund: centsToAmount(getfundBasisPoints) },
    total: centsToAmount(totalCents),
    lines: pricedLines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: centsToAmount(line.discountAmount),
      taxAmount: centsToAmount(line.taxAmount),
      taxTreatment: line.taxTreatment,
      vatAmount: centsToAmount(line.vatAmount),
      nhilAmount: centsToAmount(line.nhilAmount),
      getfundAmount: centsToAmount(line.getfundAmount),
      lineTotal: centsToAmount(line.lineTotal),
    })),
  };
}

export function returnedLineRefundCents(lineTotalCents: bigint, orderedQuantity: number, alreadyReturned: number, returningNow: number) {
  if (
    lineTotalCents < 1n ||
    !Number.isSafeInteger(orderedQuantity) ||
    !Number.isSafeInteger(alreadyReturned) ||
    !Number.isSafeInteger(returningNow) ||
    orderedQuantity < 1 ||
    alreadyReturned < 0 ||
    returningNow < 1 ||
    alreadyReturned + returningNow > orderedQuantity
  ) {
    throw new RangeError("Returned quantities must not exceed the sold quantity.");
  }
  const totalQuantity = BigInt(orderedQuantity);
  const priorCents = lineTotalCents * BigInt(alreadyReturned) / totalQuantity;
  const cumulativeCents = lineTotalCents * BigInt(alreadyReturned + returningNow) / totalQuantity;
  return cumulativeCents - priorCents;
}

export function decimalToCents(value: string) {
  return amountToCents(value);
}

export function centsToDecimal(value: bigint) {
  return centsToAmount(value);
}
