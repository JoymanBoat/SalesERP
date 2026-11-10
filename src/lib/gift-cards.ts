import { createHash, randomBytes } from "node:crypto";

import { centsToDecimal, decimalToCents } from "./pos";
import { toCsvCell } from "./reporting";
import { isCalendarDate } from "./calendar-date";

export function normalizeGiftCardCode(code: string) {
  return code.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function hashGiftCardCode(code: string) {
  const normalized = normalizeGiftCardCode(code);
  if (!/^KR[A-F0-9]{24}$/.test(normalized)) {
    throw new RangeError("Enter a valid Keta Retail gift card code.");
  }
  return createHash("sha256").update(normalized).digest("hex");
}

export function generateGiftCardCode() {
  const code = `KR${randomBytes(12).toString("hex").toUpperCase()}`;
  return {
    code: `KR-${code.slice(2, 8)}-${code.slice(8, 14)}-${code.slice(14, 20)}-${code.slice(20, 26)}`,
    codeHash: hashGiftCardCode(code),
  };
}

export function giftCardExpiryIsValid(expiresOn: string | null, businessDate: string) {
  return isCalendarDate(businessDate) &&
    (expiresOn === null || (isCalendarDate(expiresOn) && expiresOn >= businessDate));
}

export function buildGiftCardBalanceCsv(
  cards: Array<{
    codeLastFour: string;
    issuedAt: string;
    expiresOn: string | null;
    status: string;
    initialBalance: string;
    balance: string;
  }>,
  currency: string,
  businessDate: string,
) {
  const initialTotal = cards.reduce((total, card) => total + decimalToCents(card.initialBalance), 0n);
  const balanceTotal = cards.reduce((total, card) => total + decimalToCents(card.balance), 0n);
  const rows: Array<Array<string | number>> = [
    ["As of business date", businessDate, "Currency", currency],
    [],
    ["Code suffix", "Issued at", "Expiry date", "Status", "Initial value", "Recorded balance", "Currency"],
    ...cards.map((card) => [
      `•••• ${card.codeLastFour}`,
      card.issuedAt,
      card.expiresOn ?? "No expiry",
      card.status,
      card.initialBalance,
      card.balance,
      currency,
    ]),
    ["TOTAL", "", "", "", centsToDecimal(initialTotal), centsToDecimal(balanceTotal), currency],
  ];
  return `\uFEFF${rows.map((row) => row.map(toCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function buildGiftCardTransactionsCsv(
  transactions: GiftCardTransactionCsvRow[],
  currency: string,
  businessDate: string,
) {
  const accumulator = createGiftCardTransactionCsvAccumulator();
  return `${giftCardTransactionCsvHeader(currency, businessDate)}${appendGiftCardTransactionCsvRows(transactions, accumulator, currency)}${giftCardTransactionCsvFooter(accumulator, currency)}`;
}

export type GiftCardTransactionCsvRow = {
  id: string;
  cardId: string;
  codeLastFour: string;
  recordedAt: string;
  createdBy: string;
  type: "ISSUE" | "REDEEM" | "REFUND";
  amountDelta: string;
  orderNumber: number | null;
};

export function createGiftCardTransactionCsvAccumulator() {
  return {
    balances: new Map<string, bigint>(),
    totals: { issued: 0n, redeemed: 0n, refunded: 0n },
  };
}

export function giftCardTransactionCsvHeader(currency: string, businessDate: string) {
  const rows: Array<Array<string | number>> = [
    ["As of business date", businessDate, "Currency", currency],
    [],
    ["Recorded at", "Event", "Code suffix", "Sale number", "Recorded by", "Direction", "Amount", "Balance after event", "Currency"],
  ];
  return `\uFEFF${rows.map((row) => row.map(toCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function appendGiftCardTransactionCsvRows(
  transactions: GiftCardTransactionCsvRow[],
  accumulator: ReturnType<typeof createGiftCardTransactionCsvAccumulator>,
  currency: string,
) {
  const rows = transactions.map((transaction) => {
    const isNegative = transaction.amountDelta.startsWith("-");
    const magnitude = isNegative ? transaction.amountDelta.slice(1) : transaction.amountDelta;
    const amountCents = decimalToCents(magnitude) * (isNegative ? -1n : 1n);
    const balanceCents = (accumulator.balances.get(transaction.cardId) ?? 0n) + amountCents;
    accumulator.balances.set(transaction.cardId, balanceCents);
    if (transaction.type === "ISSUE") accumulator.totals.issued += amountCents;
    if (transaction.type === "REDEEM") accumulator.totals.redeemed -= amountCents;
    if (transaction.type === "REFUND") accumulator.totals.refunded += amountCents;

    return [
      transaction.recordedAt,
      transaction.type,
      `•••• ${transaction.codeLastFour}`,
      transaction.orderNumber ?? "",
      transaction.createdBy,
      isNegative ? "DEBIT" : "CREDIT",
      isNegative ? transaction.amountDelta.slice(1) : transaction.amountDelta,
      centsToDecimal(balanceCents),
      currency,
    ];
  });
  return rows.length
    ? `${rows.map((row) => row.map(toCsvCell).join(",")).join("\r\n")}\r\n`
    : "";
}

export function giftCardTransactionCsvFooter(
  accumulator: ReturnType<typeof createGiftCardTransactionCsvAccumulator>,
  currency: string,
) {
  const rows: Array<Array<string | number>> = [
    ["TOTAL BY EVENT", "", "", "", "", "", "", "", ""],
    ["Issued", "", "", "", "", "", centsToDecimal(accumulator.totals.issued), "", currency],
    ["Redeemed", "", "", "", "", "", centsToDecimal(accumulator.totals.redeemed), "", currency],
    ["Refunded", "", "", "", "", "", centsToDecimal(accumulator.totals.refunded), "", currency],
  ];
  return `${rows.map((row) => row.map(toCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function giftCardRefundCents(
  cumulativeRefundCents: bigint,
  giftCardPaidCents: bigint,
  orderTotalCents: bigint,
) {
  if (
    orderTotalCents <= 0n ||
    giftCardPaidCents < 0n ||
    giftCardPaidCents > orderTotalCents ||
    cumulativeRefundCents < 0n ||
    cumulativeRefundCents > orderTotalCents
  ) {
    throw new RangeError("Invalid gift card refund allocation.");
  }
  if (cumulativeRefundCents === orderTotalCents) return giftCardPaidCents;
  return cumulativeRefundCents * giftCardPaidCents / orderTotalCents;
}

export function giftCardTenderCents(balanceCents: bigint, orderTotalCents: bigint) {
  if (balanceCents < 0n || orderTotalCents < 0n) {
    throw new RangeError("Gift card balance and sale total must not be negative.");
  }
  return balanceCents < orderTotalCents ? balanceCents : orderTotalCents;
}
