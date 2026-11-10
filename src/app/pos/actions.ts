"use server";

import { InventoryMovementType, OrderStatus, PaymentStatus, Prisma, TaxComponent } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { canManagePricing, canOperateRegister } from "@/lib/permissions";
import { giftCardRefundCents, giftCardTenderCents, hashGiftCardCode } from "@/lib/gift-cards";
import { businessDateInTimeZone, calculatePromotionDiscount, calculateSaleTotals, canReserveInventoryQuantity, centsToDecimal, decimalToCents, eligiblePromotionSubtotal, loyaltyPointsDiscount, loyaltyPointsEarned, proratedLoyaltyPoints, promotionIsWithinDates, promotionMeetsMinimumSubtotal, returnedLineRefundCents } from "@/lib/pos";
import { cashPaymentProvider } from "@/lib/payment-provider";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { resolveTaxRatesAt } from "@/lib/tax";
import { cashCheckoutSchema, refundSchema, saleDraftSchema, saleReturnSchema, taxSettingsSchema, voidSaleSchema } from "@/lib/validation";

export type PosActionState = {
  status: "idle" | "error" | "success";
  message: string;
  orderId?: string;
  updatedAt?: string;
  conflict?: boolean;
  receiptHref?: string;
  giftCardId?: string | null;
  giftCardLastFour?: string | null;
  giftCardRedeemed?: string;
};

function parseJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function syncDraftReservations(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  storeId: string,
  orderId: string,
  lines: Array<{ variantId: string; quantity: number; trackInventory: boolean; productName: string }>,
) {
  const existingReservations = await transaction.inventoryReservation.findMany({
    where: { organizationId, storeId, orderId },
    select: { variantId: true, quantity: true },
  });
  const previous = new Map(existingReservations.map((reservation) => [reservation.variantId, reservation.quantity]));
  const next = new Map(
    lines.filter((line) => line.trackInventory).map((line) => [line.variantId, line.quantity]),
  );
  const lineByVariant = new Map(lines.map((line) => [line.variantId, line]));
  const variantIds = [...new Set([...previous.keys(), ...next.keys()])].sort();
  if (!variantIds.length) return;

  await transaction.$queryRaw`
    SELECT "id" FROM "InventoryLevel"
    WHERE "organizationId" = ${organizationId}
      AND "storeId" = ${storeId}
      AND "variantId" IN (${Prisma.join(variantIds)})
    ORDER BY "variantId"
    FOR UPDATE
  `;
  const levels = await transaction.inventoryLevel.findMany({
    where: { organizationId, storeId, variantId: { in: variantIds } },
    select: { id: true, variantId: true, quantity: true, reserved: true },
  });
  const levelsByVariant = new Map(levels.map((level) => [level.variantId, level]));

  for (const variantId of variantIds) {
    const level = levelsByVariant.get(variantId);
    if (!level) throw new Error("SALE_STOCK_RECORD_MISSING");
    const previousQuantity = previous.get(variantId) ?? 0;
    const nextQuantity = next.get(variantId) ?? 0;
    if (level.reserved < previousQuantity) throw new Error("SALE_RESERVATION_INCONSISTENT");

    if (!canReserveInventoryQuantity(level.quantity, level.reserved, nextQuantity, previousQuantity)) {
      const line = lineByVariant.get(variantId);
      throw new Error(`SALE_STOCK_SHORT:${line?.productName ?? "product"}`);
    }

    const delta = nextQuantity - previousQuantity;
    const update = await transaction.inventoryLevel.updateMany({
      where: {
        id: level.id,
        organizationId,
        storeId,
        reserved: level.reserved,
        ...(delta > 0 ? { quantity: { gte: level.reserved - previousQuantity + nextQuantity } } : {}),
      },
      data: { reserved: { increment: delta } },
    });
    if (update.count !== 1) {
      const line = lineByVariant.get(variantId);
      throw new Error(`SALE_STOCK_SHORT:${line?.productName ?? "product"}`);
    }

    if (nextQuantity > 0) {
      await transaction.inventoryReservation.upsert({
        where: { orderId_variantId: { orderId, variantId } },
        create: { organizationId, storeId, orderId, variantId, quantity: nextQuantity },
        update: { quantity: nextQuantity },
      });
    } else {
      await transaction.inventoryReservation.deleteMany({ where: { orderId, variantId } });
    }
  }
}

async function releaseDraftReservations(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  storeId: string,
  orderId: string,
) {
  const reservations = await transaction.inventoryReservation.findMany({
    where: { organizationId, storeId, orderId },
    orderBy: { variantId: "asc" },
    select: { variantId: true, quantity: true },
  });
  if (!reservations.length) return;

  const variantIds = reservations.map(({ variantId }) => variantId);
  await transaction.$queryRaw`
    SELECT "id" FROM "InventoryLevel"
    WHERE "organizationId" = ${organizationId}
      AND "storeId" = ${storeId}
      AND "variantId" IN (${Prisma.join(variantIds)})
    ORDER BY "variantId"
    FOR UPDATE
  `;
  for (const reservation of reservations) {
    const level = await transaction.inventoryLevel.findFirst({
      where: { organizationId, storeId, variantId: reservation.variantId },
      select: { id: true },
    });
    if (!level) throw new Error("SALE_RESERVATION_STOCK_MISSING");
    const released = await transaction.inventoryLevel.updateMany({
      where: { id: level.id, organizationId, storeId, reserved: { gte: reservation.quantity } },
      data: { reserved: { decrement: reservation.quantity } },
    });
    if (released.count !== 1) throw new Error("SALE_RESERVATION_INCONSISTENT");
  }
  await transaction.inventoryReservation.deleteMany({ where: { organizationId, storeId, orderId } });
}

async function resolveGiftCardSelection(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    code: string;
    requestedGiftCardId: string;
    existingGiftCardId: string | null;
    orderTotal: Prisma.Decimal;
    businessDate: string;
  },
) {
  let giftCardId = input.requestedGiftCardId || null;
  let card;
  if (input.code) {
    let codeHash: string;
    try {
      codeHash = hashGiftCardCode(input.code);
    } catch {
      throw new Error("GIFT_CARD_CODE_INVALID");
    }
    card = await transaction.giftCard.findFirst({
      where: { organizationId: input.organizationId, codeHash },
      select: { id: true, balance: true, active: true, expiresAt: true, codeLastFour: true },
    });
    if (!card) throw new Error("GIFT_CARD_CODE_INVALID");
    giftCardId = card.id;
  } else if (giftCardId) {
    if (!input.existingGiftCardId || giftCardId !== input.existingGiftCardId) {
      throw new Error("GIFT_CARD_CODE_REQUIRED");
    }
    card = await transaction.giftCard.findFirst({
      where: { id: giftCardId, organizationId: input.organizationId },
      select: { id: true, balance: true, active: true, expiresAt: true, codeLastFour: true },
    });
  }
  if (!giftCardId || !card) return { id: null, redeemed: new Prisma.Decimal(0), lastFour: null };
  if (!card.active || (card.expiresAt && card.expiresAt.toISOString().slice(0, 10) < input.businessDate)) {
    throw new Error("GIFT_CARD_UNAVAILABLE");
  }
  if (card.balance.lessThanOrEqualTo(0)) throw new Error("GIFT_CARD_EMPTY");
  const redeemedCents = giftCardTenderCents(decimalToCents(card.balance.toFixed(2)), decimalToCents(input.orderTotal.toFixed(2)));
  if (redeemedCents < 1n) throw new Error("GIFT_CARD_EMPTY");
  return { id: card.id, redeemed: new Prisma.Decimal(centsToDecimal(redeemedCents)), lastFour: card.codeLastFour };
}

async function restoreGiftCardForRefund(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    orderId: string;
    orderTotal: Prisma.Decimal;
    giftCardId: string | null;
    giftCardRedeemed: Prisma.Decimal;
    cumulativeRefund: Prisma.Decimal;
    refundId: string;
    actorId: string;
  },
) {
  if (!input.giftCardId || input.giftCardRedeemed.lessThanOrEqualTo(0)) return new Prisma.Decimal(0);
  const cardRefunded = await transaction.giftCardTransaction.aggregate({
    where: {
      organizationId: input.organizationId,
      giftCardId: input.giftCardId,
      type: "REFUND",
      refund: { is: { orderId: input.orderId } },
    },
    _sum: { amountDelta: true },
  });
  const previousGiftRefundCents = decimalToCents(cardRefunded._sum.amountDelta?.toFixed(2) ?? "0");
  const cumulativeRefundCents = decimalToCents(input.cumulativeRefund.toFixed(2));
  const targetGiftRefundCents = giftCardRefundCents(
    cumulativeRefundCents,
    decimalToCents(input.giftCardRedeemed.toFixed(2)),
    decimalToCents(input.orderTotal.toFixed(2)),
  );
  const giftRefundCents = targetGiftRefundCents - previousGiftRefundCents;
  if (giftRefundCents < 0n) throw new Error("GIFT_CARD_REFUND_INCONSISTENT");
  const giftRefund = new Prisma.Decimal(centsToDecimal(giftRefundCents));
  if (giftRefundCents === 0n) return giftRefund;

  await transaction.$queryRaw`
    SELECT "id" FROM "GiftCard"
    WHERE "id" = ${input.giftCardId} AND "organizationId" = ${input.organizationId}
    FOR UPDATE
  `;
  const updated = await transaction.giftCard.updateMany({
    where: { id: input.giftCardId, organizationId: input.organizationId },
    data: { balance: { increment: giftRefund } },
  });
  if (updated.count !== 1) throw new Error("GIFT_CARD_UNAVAILABLE");
  await transaction.giftCardTransaction.create({
    data: {
      organizationId: input.organizationId,
      giftCardId: input.giftCardId,
      refundId: input.refundId,
      type: "REFUND",
      amountDelta: giftRefund,
      createdById: input.actorId,
    },
  });
  return giftRefund;
}

async function reverseCustomerLoyaltyForRefund(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    customerId: string | null;
    orderId: string;
    refundId: string;
    orderTotal: Prisma.Decimal;
    pointsEarned: number;
    pointsRedeemed: number;
    cumulativeRefund: Prisma.Decimal;
    actorId: string;
  },
) {
  if (!input.customerId || (input.pointsEarned === 0 && input.pointsRedeemed === 0)) return;

  await transaction.$queryRaw`
    SELECT "id" FROM "Customer"
    WHERE "organizationId" = ${input.organizationId} AND "id" = ${input.customerId}
    FOR UPDATE
  `;
  const [earnedReversals, redeemedReversals] = await Promise.all([
    transaction.customerLoyaltyTransaction.aggregate({
      where: { organizationId: input.organizationId, customerId: input.customerId, orderId: input.orderId, type: "EARN_REVERSAL" },
      _sum: { pointsDelta: true },
    }),
    transaction.customerLoyaltyTransaction.aggregate({
      where: { organizationId: input.organizationId, customerId: input.customerId, orderId: input.orderId, type: "REDEEM_REVERSAL" },
      _sum: { pointsDelta: true },
    }),
  ]);
  const totalCents = decimalToCents(input.orderTotal.toFixed(2));
  const refundedCents = decimalToCents(input.cumulativeRefund.toFixed(2));
  const earnedTarget = proratedLoyaltyPoints(input.pointsEarned, refundedCents, totalCents);
  const redeemedTarget = proratedLoyaltyPoints(input.pointsRedeemed, refundedCents, totalCents);
  const earnedAlreadyReversed = Number(-(earnedReversals._sum.pointsDelta ?? 0n));
  const redeemedAlreadyReturned = Number(redeemedReversals._sum.pointsDelta ?? 0n);
  const earnedReversal = Math.max(0, earnedTarget - earnedAlreadyReversed);
  const redeemedReturn = Math.max(0, redeemedTarget - redeemedAlreadyReturned);
  const balanceDelta = BigInt(redeemedReturn - earnedReversal);
  if (balanceDelta === 0n) return;

  if (earnedReversal) {
    await transaction.customerLoyaltyTransaction.create({
      data: {
        organizationId: input.organizationId,
        customerId: input.customerId,
        orderId: input.orderId,
        refundId: input.refundId,
        type: "EARN_REVERSAL",
        pointsDelta: BigInt(-earnedReversal),
        reason: "Reverse earned points proportionally to cash refunded.",
      },
    });
  }
  if (redeemedReturn) {
    await transaction.customerLoyaltyTransaction.create({
      data: {
        organizationId: input.organizationId,
        customerId: input.customerId,
        orderId: input.orderId,
        refundId: input.refundId,
        type: "REDEEM_REVERSAL",
        pointsDelta: BigInt(redeemedReturn),
        reason: "Return redeemed points proportionally to cash refunded.",
      },
    });
  }
  await transaction.customer.update({
    where: { id: input.customerId },
    data: { loyaltyPoints: { increment: balanceDelta } },
  });
  await transaction.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "customer.loyalty_adjusted_for_refund",
      entityType: "Customer",
      entityId: input.customerId,
      details: { orderId: input.orderId, refundId: input.refundId, pointsDelta: Number(balanceDelta) },
    },
  });
}

export async function saveSaleDraft(
  _previousState: PosActionState,
  formData: FormData,
): Promise<PosActionState> {
  const parsed = saleDraftSchema.safeParse({
    orderId: formData.get("orderId") || "",
    expectedUpdatedAt: formData.get("expectedUpdatedAt") || undefined,
    customerId: formData.get("customerId") || "",
    discountTotal: formData.get("discountTotal") || "0",
    promotionCode: formData.get("promotionCode") || "",
    giftCardCode: formData.get("giftCardCode") || "",
    giftCardId: formData.get("giftCardId") || "",
    loyaltyPointsRedeemed: formData.get("loyaltyPointsRedeemed") || "0",
    notes: formData.get("notes") || "",
    lines: parseJson(formData.get("lines")),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the sale details." };

  const { organization, membership, store, register } = await getWorkspace({ feature: "pos", operation: "change" });
  if (!canOperateRegister(membership.role)) return { status: "error", message: "Your role cannot use the register." };
  if (!register) return { status: "error", message: "You do not have access to an active POS register at this store." };
  if (Number(parsed.data.discountTotal) > 0 && !canManagePricing(membership.role)) {
    return { status: "error", message: "Only an owner or manager can apply a sale discount." };
  }

  try {
    const savedOrder = await prisma.$transaction(async (transaction) => {
      const [shift] = await transaction.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "RegisterShift"
        WHERE "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
          AND "registerId" = ${register.id}
          AND "closedAt" IS NULL
        ORDER BY "openedAt" DESC
        LIMIT 1
        FOR UPDATE
      `;
      if (!shift) throw new Error("REGISTER_SHIFT_NOT_OPEN");

      const customerId = parsed.data.customerId || null;
      if (customerId) {
        const customer = await transaction.customer.findFirst({
          where: { id: customerId, organizationId: organization.id, archivedAt: null },
          select: { id: true, loyaltyPoints: true },
        });
        if (!customer) throw new Error("SALE_CUSTOMER_NOT_AVAILABLE");
        if (parsed.data.loyaltyPointsRedeemed > 0 && BigInt(parsed.data.loyaltyPointsRedeemed) > customer.loyaltyPoints) {
          throw new Error("LOYALTY_POINTS_UNAVAILABLE");
        }
      } else if (parsed.data.loyaltyPointsRedeemed > 0) {
        throw new Error("LOYALTY_CUSTOMER_REQUIRED");
      }

      const variants = await transaction.productVariant.findMany({
        where: {
          organizationId: organization.id,
          id: { in: parsed.data.lines.map((line) => line.variantId) },
          product: { archivedAt: null },
        },
        select: {
          id: true,
          name: true,
          sku: true,
          unitPrice: true,
          trackInventory: true,
          productId: true,
          product: { select: { name: true, taxTreatment: true } },
        },
      });
      if (variants.length !== parsed.data.lines.length) throw new Error("SALE_PRODUCT_NOT_AVAILABLE");
      const byId = new Map(variants.map((variant) => [variant.id, variant]));
      const pricedLines = parsed.data.lines.map((line) => {
        const variant = byId.get(line.variantId);
        if (!variant) throw new Error("SALE_PRODUCT_NOT_AVAILABLE");
        return { ...line, unitPrice: variant.unitPrice.toString(), productId: variant.productId, taxTreatment: variant.product.taxTreatment };
      });
      let promotion: { id: string; code: string; productIds: string[] } | null = null;
      let totals;
      try {
        let discount = parsed.data.discountTotal;
        if (parsed.data.loyaltyPointsRedeemed > 0) {
          if (parsed.data.promotionCode || Number(parsed.data.discountTotal) > 0) {
            throw new Error("LOYALTY_DISCOUNT_CONFLICT");
          }
          discount = loyaltyPointsDiscount(parsed.data.loyaltyPointsRedeemed);
        } else if (parsed.data.promotionCode) {
          if (Number(parsed.data.discountTotal) > 0) throw new Error("PROMOTION_AND_MANUAL_DISCOUNT");
          const found = await transaction.promotion.findFirst({
            where: {
              organizationId: organization.id,
              code: parsed.data.promotionCode,
              active: true,
            },
            select: {
              id: true,
              code: true,
              type: true,
              value: true,
              maxRedemptions: true,
              redemptionCount: true,
              minimumSubtotal: true,
              startsOn: true,
              endsOn: true,
              products: { select: { productId: true } },
            },
          });
          const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
          if (
            !found ||
            (found.maxRedemptions !== null && found.redemptionCount >= found.maxRedemptions) ||
            !promotionIsWithinDates(
              found.startsOn?.toISOString().slice(0, 10) ?? null,
              found.endsOn?.toISOString().slice(0, 10) ?? null,
              businessDate,
            )
          ) {
            throw new Error("PROMOTION_UNAVAILABLE");
          }
          const eligibleProductIds = found.products.map(({ productId }) => productId);
          const eligibleVariantIds = eligibleProductIds.length
            ? pricedLines.filter((line) => eligibleProductIds.includes(line.productId)).map((line) => line.variantId)
            : null;
          if (eligibleVariantIds && eligibleVariantIds.length === 0) throw new Error("PROMOTION_PRODUCTS_NOT_IN_CART");
          const eligibleSubtotal = eligiblePromotionSubtotal(pricedLines, eligibleVariantIds);
          if (!promotionMeetsMinimumSubtotal(eligibleSubtotal, found.minimumSubtotal.toString())) {
            throw new Error("PROMOTION_MINIMUM_NOT_MET");
          }
          discount = calculatePromotionDiscount(eligibleSubtotal, found.type, found.value.toString());
          promotion = { id: found.id, code: found.code, productIds: eligibleProductIds };
        }
        const selectedPromotion = promotion;
        const eligibleVariantIds = selectedPromotion?.productIds.length
          ? pricedLines.filter((line) => selectedPromotion.productIds.includes(line.productId)).map((line) => line.variantId)
          : undefined;
        const taxHistory = await transaction.taxRateSetting.findMany({
          where: { organizationId: organization.id },
          select: { component: true, rate: true, effectiveFrom: true },
        });
        const taxRates = resolveTaxRatesAt(
          taxHistory.map((entry) => ({
            component: entry.component,
            rate: entry.rate.toFixed(2),
            effectiveFrom: entry.effectiveFrom.toISOString().slice(0, 10),
          })),
          businessDateInTimeZone(new Date(), organization.timezone),
        );
        totals = calculateSaleTotals(pricedLines, discount, taxRates, eligibleVariantIds);
      } catch (error) {
        if (error instanceof Error && (error.message.startsWith("PROMOTION_") || error.message.startsWith("LOYALTY_"))) throw error;
        throw new Error(error instanceof Error ? `SALE_TOTALS:${error.message}` : "SALE_TOTALS_INVALID");
      }

      let order;
      let selectedGiftCard: { id: string | null; redeemed: Prisma.Decimal; lastFour: string | null };
      if (parsed.data.orderId) {
        await transaction.$queryRaw`
          SELECT "id" FROM "Order"
          WHERE "id" = ${parsed.data.orderId}
            AND "organizationId" = ${organization.id}
            AND "storeId" = ${store.id}
          FOR UPDATE
        `;
        const existing = await transaction.order.findFirst({
          where: {
            id: parsed.data.orderId,
            organizationId: organization.id,
            storeId: store.id,
            status: OrderStatus.DRAFT,
            registerShiftId: shift.id,
          },
          include: { items: { select: { variantId: true, quantity: true } } },
        });
        if (!existing) throw new Error("SALE_DRAFT_UNAVAILABLE");
        if (existing.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) {
          throw new Error("SALE_DRAFT_CHANGED");
        }
        const giftCard = await resolveGiftCardSelection(transaction, {
          organizationId: organization.id,
          code: parsed.data.giftCardCode,
          requestedGiftCardId: parsed.data.giftCardId,
          existingGiftCardId: existing.giftCardId,
          orderTotal: new Prisma.Decimal(totals.total),
          businessDate: businessDateInTimeZone(new Date(), organization.timezone),
        });
        selectedGiftCard = giftCard;
        await syncDraftReservations(
          transaction,
          organization.id,
          store.id,
          existing.id,
          totals.lines.map((line) => {
            const variant = byId.get(line.variantId);
            if (!variant) throw new Error("SALE_PRODUCT_NOT_AVAILABLE");
            return {
              variantId: variant.id,
              quantity: line.quantity,
              trackInventory: variant.trackInventory,
              productName: variant.product.name,
            };
          }),
        );
        await transaction.orderItem.deleteMany({ where: { orderId: existing.id } });
        order = await transaction.order.update({
          where: { id: existing.id },
          data: {
            customerId,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            taxTotal: totals.taxTotal,
            taxRate: totals.taxRate,
            vatRate: totals.rates.vat,
            nhilRate: totals.rates.nhil,
            getfundRate: totals.rates.getfund,
            vatTotal: totals.vatTotal,
            nhilTotal: totals.nhilTotal,
            getfundTotal: totals.getfundTotal,
            taxComponentsRecorded: true,
            total: totals.total,
            promotionId: promotion?.id ?? null,
            promotionCode: promotion?.code ?? null,
            giftCardId: giftCard.id,
            giftCardRedeemed: giftCard.redeemed,
            loyaltyPointsRedeemed: BigInt(parsed.data.loyaltyPointsRedeemed),
            notes: parsed.data.notes || null,
            items: {
              create: totals.lines.map((line) => {
                const variant = byId.get(line.variantId);
                if (!variant) throw new Error("SALE_PRODUCT_NOT_AVAILABLE");
                return {
                  variantId: variant.id,
                  productName: variant.product.name,
                  sku: variant.sku,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  lineTotal: line.lineTotal,
                  discountAmount: line.discountAmount,
                  taxAmount: line.taxAmount,
                  taxTreatment: line.taxTreatment,
                  vatAmount: line.vatAmount,
                  nhilAmount: line.nhilAmount,
                  getfundAmount: line.getfundAmount,
                };
              }),
            },
          },
          select: { id: true, number: true, updatedAt: true },
        });
      } else {
        const giftCard = await resolveGiftCardSelection(transaction, {
          organizationId: organization.id,
          code: parsed.data.giftCardCode,
          requestedGiftCardId: parsed.data.giftCardId,
          existingGiftCardId: null,
          orderTotal: new Prisma.Decimal(totals.total),
          businessDate: businessDateInTimeZone(new Date(), organization.timezone),
        });
        selectedGiftCard = giftCard;
        if (parsed.data.giftCardId && !parsed.data.giftCardCode) throw new Error("GIFT_CARD_CODE_REQUIRED");
        await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
        const latest = await transaction.order.aggregate({
          where: { organizationId: organization.id },
          _max: { number: true },
        });
        order = await transaction.order.create({
          data: {
            organizationId: organization.id,
            storeId: store.id,
            registerShiftId: shift.id,
            customerId,
            createdById: membership.userId,
            number: (latest._max.number ?? 0) + 1,
            status: OrderStatus.DRAFT,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            taxTotal: totals.taxTotal,
            taxRate: totals.taxRate,
            vatRate: totals.rates.vat,
            nhilRate: totals.rates.nhil,
            getfundRate: totals.rates.getfund,
            vatTotal: totals.vatTotal,
            nhilTotal: totals.nhilTotal,
            getfundTotal: totals.getfundTotal,
            taxComponentsRecorded: true,
            total: totals.total,
            promotionId: promotion?.id ?? null,
            promotionCode: promotion?.code ?? null,
            giftCardId: giftCard.id,
            giftCardRedeemed: giftCard.redeemed,
            loyaltyPointsRedeemed: BigInt(parsed.data.loyaltyPointsRedeemed),
            currency: organization.currency,
            notes: parsed.data.notes || null,
            items: {
              create: totals.lines.map((line) => {
                const variant = byId.get(line.variantId);
                if (!variant) throw new Error("SALE_PRODUCT_NOT_AVAILABLE");
                return {
                  variantId: variant.id,
                  productName: variant.product.name,
                  sku: variant.sku,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  lineTotal: line.lineTotal,
                  discountAmount: line.discountAmount,
                  taxAmount: line.taxAmount,
                  taxTreatment: line.taxTreatment,
                  vatAmount: line.vatAmount,
                  nhilAmount: line.nhilAmount,
                  getfundAmount: line.getfundAmount,
                };
              }),
            },
          },
          select: { id: true, number: true, updatedAt: true },
        });
        await syncDraftReservations(
          transaction,
          organization.id,
          store.id,
          order.id,
          totals.lines.map((line) => {
            const variant = byId.get(line.variantId);
            if (!variant) throw new Error("SALE_PRODUCT_NOT_AVAILABLE");
            return {
              variantId: variant.id,
              quantity: line.quantity,
              trackInventory: variant.trackInventory,
              productName: variant.product.name,
            };
          }),
        );
      }

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: parsed.data.orderId ? "pos.draft_updated" : "pos.draft_created",
          entityType: "Order",
          entityId: order.id,
          details: {
            number: order.number,
            lineCount: totals.lines.length,
            total: totals.total,
            promotionCode: promotion?.code ?? null,
            loyaltyPointsRedeemed: parsed.data.loyaltyPointsRedeemed,
          },
        },
      });
      return {
        id: order.id,
        updatedAt: order.updatedAt.toISOString(),
        giftCardId: selectedGiftCard.id,
        giftCardLastFour: selectedGiftCard.lastFour,
        giftCardRedeemed: selectedGiftCard.redeemed.toFixed(2),
      };
    });

    revalidatePath("/pos");
    revalidatePath("/register-shifts");
    return {
      status: "success",
      message: "Sale saved as a held cart.",
      orderId: savedOrder.id,
      updatedAt: savedOrder.updatedAt,
      giftCardId: savedOrder.giftCardId,
      giftCardLastFour: savedOrder.giftCardLastFour,
      giftCardRedeemed: savedOrder.giftCardRedeemed,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "REGISTER_SHIFT_NOT_OPEN") return { status: "error", message: "Open a register shift before starting a sale." };
    if (error instanceof Error && error.message === "SALE_CUSTOMER_NOT_AVAILABLE") return { status: "error", message: "That customer is unavailable. Refresh and try again." };
    if (error instanceof Error && error.message === "LOYALTY_CUSTOMER_REQUIRED") return { status: "error", message: "Select a customer to redeem loyalty points." };
    if (error instanceof Error && error.message === "LOYALTY_POINTS_UNAVAILABLE") return { status: "error", message: "The customer does not have enough loyalty points. Refresh the balance and try again." };
    if (error instanceof Error && error.message === "LOYALTY_DISCOUNT_CONFLICT") return { status: "error", message: "Redeem loyalty points separately from a promotion or manual discount." };
    if (error instanceof Error && error.message === "SALE_PRODUCT_NOT_AVAILABLE") return { status: "error", message: "One or more products are no longer active. Refresh and try again." };
    if (error instanceof Error && error.message === "SALE_DRAFT_UNAVAILABLE") return { status: "error", message: "That held cart is no longer editable. Refresh to continue." };
    if (error instanceof Error && error.message === "SALE_DRAFT_CHANGED") return { status: "error", message: "This held cart changed on the server. Your local cart remains saved; discard local changes and reload before continuing.", conflict: true };
    if (error instanceof Error && error.message === "SALE_STOCK_RECORD_MISSING") return { status: "error", message: "An inventory record is missing; the held cart was not saved." };
    if (error instanceof Error && error.message.startsWith("SALE_STOCK_SHORT:")) return { status: "error", message: `Not enough unreserved stock is available for ${error.message.slice("SALE_STOCK_SHORT:".length)}.` };
    if (error instanceof Error && error.message === "SALE_RESERVATION_INCONSISTENT") return { status: "error", message: "Stock reservation data is inconsistent. Contact an administrator before changing this cart." };
    if (error instanceof Error && error.message === "PROMOTION_UNAVAILABLE") return { status: "error", message: "That promotion code is unavailable or has reached its redemption limit." };
    if (error instanceof Error && error.message === "PROMOTION_MINIMUM_NOT_MET") return { status: "error", message: "The sale subtotal does not meet this promotion's minimum spend." };
    if (error instanceof Error && error.message === "PROMOTION_PRODUCTS_NOT_IN_CART") return { status: "error", message: "The cart must include at least one product eligible for this promotion." };
    if (error instanceof Error && error.message === "PROMOTION_AND_MANUAL_DISCOUNT") return { status: "error", message: "Use either a promotion code or a manual discount, not both." };
    if (error instanceof Error && error.message === "GIFT_CARD_CODE_INVALID") return { status: "error", message: "That gift card code is invalid." };
    if (error instanceof Error && error.message === "GIFT_CARD_CODE_REQUIRED") return { status: "error", message: "Enter the gift card code to add it to this cart." };
    if (error instanceof Error && error.message === "GIFT_CARD_UNAVAILABLE") return { status: "error", message: "That gift card is inactive, expired, or unavailable." };
    if (error instanceof Error && error.message === "GIFT_CARD_EMPTY") return { status: "error", message: "That gift card has no available balance." };
    if (error instanceof Error && error.message.startsWith("SALE_TOTALS:")) return { status: "error", message: error.message.slice("SALE_TOTALS:".length) };
    console.error("Sale draft could not be saved.", error);
    return { status: "error", message: "The sale could not be saved. Please try again." };
  }
}

export async function checkoutCash(
  _previousState: PosActionState,
  formData: FormData,
): Promise<PosActionState> {
  const parsed = cashCheckoutSchema.safeParse({
    orderId: formData.get("orderId"),
    cashReceived: formData.get("cashReceived"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the cash received." };

  const { organization, membership, store, register } = await getWorkspace({ feature: "pos", operation: "change" });
  if (!canOperateRegister(membership.role)) return { status: "error", message: "Your role cannot check out sales." };
  if (!register) return { status: "error", message: "You do not have access to an active POS register at this store." };

  try {
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Order"
        WHERE "id" = ${parsed.data.orderId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
        FOR UPDATE
      `;
      const order = await transaction.order.findFirst({
        where: {
          id: parsed.data.orderId,
          organizationId: organization.id,
          storeId: store.id,
          status: OrderStatus.DRAFT,
          registerShift: { is: { registerId: register.id } },
        },
        include: { items: { include: { variant: { select: { trackInventory: true, productId: true } } } } },
      });
      if (!order || !order.items.length) throw new Error("SALE_DRAFT_UNAVAILABLE");
      const shift = await transaction.registerShift.findFirst({
        where: {
          id: order.registerShiftId ?? "",
          organizationId: organization.id,
          storeId: store.id,
          closedAt: null,
        },
        select: { id: true },
      });
      if (!shift) throw new Error("REGISTER_SHIFT_NOT_OPEN");
      let checkoutPromotion: { id: string; maxRedemptions: number | null } | null = null;
      if (order.promotionId) {
        await transaction.$queryRaw`
          SELECT "id" FROM "Promotion"
          WHERE "organizationId" = ${organization.id} AND "id" = ${order.promotionId}
          FOR UPDATE
        `;
        const promotion = await transaction.promotion.findFirst({
          where: {
            id: order.promotionId,
            organizationId: organization.id,
            code: order.promotionCode ?? "",
            active: true,
          },
          select: {
            id: true,
            maxRedemptions: true,
            redemptionCount: true,
            minimumSubtotal: true,
            startsOn: true,
            endsOn: true,
            products: { select: { productId: true } },
          },
        });
        if (
          !promotion ||
          (promotion.maxRedemptions !== null && promotion.redemptionCount >= promotion.maxRedemptions) ||
          !promotionIsWithinDates(
            promotion.startsOn?.toISOString().slice(0, 10) ?? null,
            promotion.endsOn?.toISOString().slice(0, 10) ?? null,
            businessDateInTimeZone(new Date(), organization.timezone),
          )
        ) {
          throw new Error("PROMOTION_UNAVAILABLE");
        }
        const eligibleProductIds = promotion.products.map(({ productId }) => productId);
        const eligibleItems = eligibleProductIds.length
          ? order.items.filter((item) => item.variantId && item.variant && eligibleProductIds.includes(item.variant.productId))
          : order.items;
        if (eligibleItems.length === 0) throw new Error("PROMOTION_PRODUCTS_NOT_IN_CART");
        const eligibleSubtotal = eligibleItems.reduce(
          (subtotal, item) => subtotal.plus(item.unitPrice.mul(item.quantity)),
          new Prisma.Decimal(0),
        );
        if (!promotionMeetsMinimumSubtotal(eligibleSubtotal.toFixed(2), promotion.minimumSubtotal.toString())) {
          throw new Error("PROMOTION_MINIMUM_NOT_MET");
        }
        checkoutPromotion = { id: promotion.id, maxRedemptions: promotion.maxRedemptions };
      } else if (order.promotionCode) {
        throw new Error("PROMOTION_UNAVAILABLE");
      }

      const amountDue = new Prisma.Decimal(order.total);
      const cashReceived = new Prisma.Decimal(parsed.data.cashReceived);
      const giftCardAmount = new Prisma.Decimal(order.giftCardRedeemed);
      if (giftCardAmount.lessThan(0) || giftCardAmount.greaterThan(amountDue)) throw new Error("GIFT_CARD_REDEMPTION_INVALID");
      if (giftCardAmount.greaterThan(0)) {
        if (!order.giftCardId) throw new Error("GIFT_CARD_REDEMPTION_INVALID");
        await transaction.$queryRaw`
          SELECT "id" FROM "GiftCard"
          WHERE "id" = ${order.giftCardId} AND "organizationId" = ${organization.id}
          FOR UPDATE
        `;
        const card = await transaction.giftCard.findFirst({
          where: { id: order.giftCardId, organizationId: organization.id },
          select: { id: true, balance: true, active: true, expiresAt: true },
        });
        if (
          !card ||
          !card.active ||
          (card.expiresAt && card.expiresAt.toISOString().slice(0, 10) < businessDateInTimeZone(new Date(), organization.timezone)) ||
          card.balance.lessThan(giftCardAmount)
        ) throw new Error("GIFT_CARD_BALANCE_CHANGED");
      } else if (order.giftCardId) {
        throw new Error("GIFT_CARD_REDEMPTION_INVALID");
      }
      const cashDue = amountDue.minus(giftCardAmount);
      if (cashReceived.lessThan(cashDue)) throw new Error("SALE_CASH_SHORT");
      if (cashDue.isZero() && cashReceived.greaterThan(0)) throw new Error("SALE_CASH_NOT_REQUIRED");
      let customerBalance = 0n;
      if (order.customerId) {
        await transaction.$queryRaw`
          SELECT "id" FROM "Customer"
          WHERE "organizationId" = ${organization.id} AND "id" = ${order.customerId}
          FOR UPDATE
        `;
        const customer = await transaction.customer.findFirst({
          where: { id: order.customerId, organizationId: organization.id },
          select: { id: true, loyaltyPoints: true },
        });
        if (!customer) throw new Error("LOYALTY_CUSTOMER_UNAVAILABLE");
        customerBalance = customer.loyaltyPoints;
        if (order.loyaltyPointsRedeemed > 0n && order.loyaltyPointsRedeemed > customerBalance) {
          throw new Error("LOYALTY_POINTS_UNAVAILABLE");
        }
      } else if (order.loyaltyPointsRedeemed > 0n) {
        throw new Error("LOYALTY_CUSTOMER_REQUIRED");
      }
      const pointsEarned = order.customerId ? loyaltyPointsEarned(amountDue.toFixed(2)) : 0;
      const loyaltyBalanceDelta = BigInt(pointsEarned) - order.loyaltyPointsRedeemed;
      const trackedLines = order.items.filter((item) => item.variant?.trackInventory);
      const reservations = await transaction.inventoryReservation.findMany({
        where: { organizationId: organization.id, storeId: store.id, orderId: order.id },
        select: { variantId: true, quantity: true },
      });
      const reservationByVariant = new Map(reservations.map((reservation) => [reservation.variantId, reservation.quantity]));
      const trackedIds = trackedLines.map((item) => item.variantId).filter((id): id is string => id !== null);
      const variantIds = [...new Set([...trackedIds, ...reservations.map(({ variantId }) => variantId)])].sort();
      if (variantIds.length) {
        await transaction.$queryRaw`
          SELECT "id" FROM "InventoryLevel"
          WHERE "organizationId" = ${organization.id}
            AND "storeId" = ${store.id}
            AND "variantId" IN (${Prisma.join(variantIds)})
          ORDER BY "variantId"
          FOR UPDATE
        `;
      }
      for (const item of trackedLines) {
        if (!item.variantId) throw new Error("SALE_STOCK_RECORD_MISSING");
        const level = await transaction.inventoryLevel.findFirst({
          where: { organizationId: organization.id, storeId: store.id, variantId: item.variantId },
          select: { id: true, quantity: true, reserved: true },
        });
        if (!level) throw new Error("SALE_STOCK_RECORD_MISSING");
        const reservationQuantity = reservationByVariant.get(item.variantId) ?? 0;
        if (reservationQuantity !== 0 && reservationQuantity !== item.quantity) {
          throw new Error("SALE_RESERVATION_INCONSISTENT");
        }
        const stockCondition = organization.allowNegativeStock
          ? { gte: level.reserved - reservationQuantity }
          : { gte: level.reserved - reservationQuantity + item.quantity };
        const updated = await transaction.inventoryLevel.updateMany({
          where: {
            id: level.id,
            organizationId: organization.id,
            storeId: store.id,
            quantity: stockCondition,
            reserved: level.reserved,
          },
          data: {
            quantity: { decrement: item.quantity },
            ...(reservationQuantity > 0 ? { reserved: { decrement: reservationQuantity } } : {}),
          },
        });
        if (updated.count !== 1) throw new Error(`SALE_STOCK_SHORT:${item.productName}`);
        await transaction.inventoryMovement.create({
          data: {
            organizationId: organization.id,
            storeId: store.id,
            variantId: item.variantId,
            createdById: membership.userId,
            type: InventoryMovementType.SALE,
            quantityDelta: -item.quantity,
            reason: `POS sale #${order.number}`,
            reference: order.id,
          },
        });
      }
      const trackedVariantSet = new Set(trackedIds);
      for (const reservation of reservations) {
        if (trackedVariantSet.has(reservation.variantId)) continue;
        const released = await transaction.inventoryLevel.updateMany({
          where: {
            organizationId: organization.id,
            storeId: store.id,
            variantId: reservation.variantId,
            reserved: { gte: reservation.quantity },
          },
          data: { reserved: { decrement: reservation.quantity } },
        });
        if (released.count !== 1) throw new Error("SALE_RESERVATION_INCONSISTENT");
      }
      if (reservations.length) {
        await transaction.inventoryReservation.deleteMany({
          where: { organizationId: organization.id, storeId: store.id, orderId: order.id },
        });
      }

      let cashPaymentId: string | null = null;
      if (giftCardAmount.greaterThan(0)) {
        const giftCardId = order.giftCardId;
        if (!giftCardId) throw new Error("GIFT_CARD_REDEMPTION_INVALID");
        const debited = await transaction.giftCard.updateMany({
          where: {
            id: giftCardId,
            organizationId: organization.id,
            active: true,
            balance: { gte: giftCardAmount },
          },
          data: { balance: { decrement: giftCardAmount } },
        });
        if (debited.count !== 1) throw new Error("GIFT_CARD_BALANCE_CHANGED");
        await transaction.giftCardTransaction.create({
          data: {
            organizationId: organization.id,
            giftCardId,
            orderId: order.id,
            type: "REDEEM",
            amountDelta: giftCardAmount.negated(),
            createdById: membership.userId,
          },
        });
        await transaction.payment.create({
          data: {
            orderId: order.id,
            method: "GIFT_CARD",
            status: PaymentStatus.SUCCEEDED,
            amount: giftCardAmount,
            provider: "stored-value-gift-card",
            providerRef: giftCardId,
            idempotencyKey: `gift-card-order:${order.id}`,
          },
        });
      }
      if (cashDue.greaterThan(0)) {
        const settlement = cashPaymentProvider.settle({
          amount: cashDue.toString(),
          idempotencyKey: `cash-order:${order.id}`,
        });
        const payment = await transaction.payment.create({
          data: {
            orderId: order.id,
            method: settlement.method,
            status: settlement.status,
            amount: cashDue,
            provider: settlement.provider,
            providerRef: settlement.providerRef,
            idempotencyKey: settlement.idempotencyKey,
            cashReceived,
            changeGiven: cashReceived.minus(cashDue),
          },
        });
        cashPaymentId = payment.id;
      }
      if (checkoutPromotion) {
        const redeemed = await transaction.promotion.updateMany({
          where: {
            id: checkoutPromotion.id,
            organizationId: organization.id,
            active: true,
            ...(order.promotionCode ? { code: order.promotionCode } : {}),
            ...(checkoutPromotion.maxRedemptions !== null
              ? { redemptionCount: { lt: checkoutPromotion.maxRedemptions } }
              : {}),
          },
          data: { redemptionCount: { increment: 1 } },
        });
        if (redeemed.count !== 1) throw new Error("PROMOTION_UNAVAILABLE");
      }
      if (order.customerId && (pointsEarned > 0 || order.loyaltyPointsRedeemed > 0n)) {
        await transaction.customer.update({
          where: { id: order.customerId },
          data: { loyaltyPoints: { increment: loyaltyBalanceDelta } },
        });
        if (pointsEarned > 0) {
          await transaction.customerLoyaltyTransaction.create({
            data: {
              organizationId: organization.id,
              customerId: order.customerId,
              orderId: order.id,
              type: "EARN",
              pointsDelta: BigInt(pointsEarned),
              reason: "Earn one point per full GHS 1 of paid sale.",
            },
          });
        }
        if (order.loyaltyPointsRedeemed > 0n) {
          await transaction.customerLoyaltyTransaction.create({
            data: {
              organizationId: organization.id,
              customerId: order.customerId,
              orderId: order.id,
              type: "REDEEM",
              pointsDelta: -order.loyaltyPointsRedeemed,
              reason: "Redeem 100 loyalty points for GHS 1.",
            },
          });
        }
        await transaction.auditLog.create({
          data: {
            organizationId: organization.id,
            actorId: membership.userId,
            action: "customer.loyalty_points_updated",
            entityType: "Customer",
            entityId: order.customerId,
            details: { orderId: order.id, pointsEarned, pointsRedeemed: Number(order.loyaltyPointsRedeemed), balanceDelta: Number(loyaltyBalanceDelta) },
          },
        });
      }
      await transaction.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PAID, loyaltyPointsEarned: BigInt(pointsEarned) },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "pos.sale_completed",
          entityType: "Order",
          entityId: order.id,
          details: {
            number: order.number,
            shiftId: shift.id,
            cashPaymentId,
            giftCardId: order.giftCardId,
            giftCardRedeemed: giftCardAmount.toString(),
            total: amountDue.toString(),
            cashReceived: cashReceived.toString(),
            changeGiven: cashReceived.minus(cashDue).toString(),
            loyaltyPointsEarned: pointsEarned,
            loyaltyPointsRedeemed: Number(order.loyaltyPointsRedeemed),
          },
        },
      });
      return { change: cashReceived.minus(cashDue).toString() };
    });

    revalidatePath("/pos");
    revalidatePath("/pos/transactions");
    revalidatePath("/register-shifts");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    revalidatePath("/customers");
    revalidatePath("/gift-cards");
    return {
      status: "success",
      message: `Sale completed. Change due: ${organization.currency} ${Number(result.change).toFixed(2)}.`,
      orderId: parsed.data.orderId,
      receiptHref: `/pos/receipt/${parsed.data.orderId}`,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "SALE_DRAFT_UNAVAILABLE") return { status: "error", message: "That held cart is no longer available for checkout." };
    if (error instanceof Error && error.message === "REGISTER_SHIFT_NOT_OPEN") return { status: "error", message: "The register shift for this cart is closed." };
    if (error instanceof Error && error.message === "SALE_CASH_SHORT") return { status: "error", message: "Cash received is less than the amount due." };
    if (error instanceof Error && error.message === "SALE_CASH_NOT_REQUIRED") return { status: "error", message: "No cash is due; leave cash received at zero." };
    if (error instanceof Error && error.message === "GIFT_CARD_REDEMPTION_INVALID") return { status: "error", message: "The held cart has invalid gift card details. Save it again and retry checkout." };
    if (error instanceof Error && error.message === "GIFT_CARD_BALANCE_CHANGED") return { status: "error", message: "The gift card is inactive, expired, or its balance changed. Update the held cart and retry checkout." };
    if (error instanceof Error && error.message === "LOYALTY_CUSTOMER_UNAVAILABLE") return { status: "error", message: "The customer loyalty account is unavailable. No sale was completed." };
    if (error instanceof Error && error.message === "LOYALTY_CUSTOMER_REQUIRED") return { status: "error", message: "Select a customer to redeem loyalty points." };
    if (error instanceof Error && error.message === "LOYALTY_POINTS_UNAVAILABLE") return { status: "error", message: "This customer's loyalty balance has changed. Update the cart and try again." };
    if (error instanceof Error && error.message === "PROMOTION_UNAVAILABLE") return { status: "error", message: "This promotion is no longer available. Update the cart and try another code." };
    if (error instanceof Error && error.message === "PROMOTION_MINIMUM_NOT_MET") return { status: "error", message: "This cart no longer meets the promotion's minimum spend. Update the cart before checkout." };
    if (error instanceof Error && error.message === "PROMOTION_PRODUCTS_NOT_IN_CART") return { status: "error", message: "This cart no longer contains eligible products for the promotion. Update the cart before checkout." };
    if (error instanceof Error && error.message === "SALE_STOCK_RECORD_MISSING") return { status: "error", message: "An inventory record is missing for a tracked product; no sale was completed." };
    if (error instanceof Error && error.message === "SALE_RESERVATION_INCONSISTENT") return { status: "error", message: "Stock reservation data is inconsistent. Contact an administrator before checkout." };
    if (error instanceof Error && error.message.startsWith("SALE_STOCK_SHORT:")) return { status: "error", message: `Not enough available stock for ${error.message.slice("SALE_STOCK_SHORT:".length)}.` };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "error", message: "This sale was already checked out. Refresh the transaction list." };
    console.error("POS checkout failed.", error);
    return { status: "error", message: "The sale could not be completed. Please try again." };
  }
}

export async function refundSale(
  _previousState: PosActionState,
  formData: FormData,
): Promise<PosActionState> {
  const parsed = refundSchema.safeParse({
    orderId: formData.get("orderId"),
    amount: formData.get("amount"),
    reason: formData.get("reason"),
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the refund details." };
  const { organization, membership, store, register } = await getWorkspace({ feature: "pos", operation: "change" });
  if (!canManagePricing(membership.role)) return { status: "error", message: "Only an owner or manager can issue a refund." };
  if (!register) return { status: "error", message: "You do not have access to an active POS register at this store." };

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Order"
        WHERE "id" = ${parsed.data.orderId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
        FOR UPDATE
      `;
      const priorRequest = await transaction.refund.findUnique({
        where: { idempotencyKey: parsed.data.idempotencyKey, organizationId: organization.id },
        select: { id: true },
      });
      if (priorRequest) return;

      const order = await transaction.order.findFirst({
        where: {
          id: parsed.data.orderId,
          organizationId: organization.id,
          storeId: store.id,
          status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED] },
        },
        include: { payments: { where: { status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED] } } } },
      });
      if (!order) throw new Error("SALE_NOT_REFUNDABLE");
      const priorRefunds = await transaction.refund.aggregate({
        where: { orderId: order.id },
        _sum: { amount: true },
      });
      const remaining = order.total.minus(priorRefunds._sum.amount ?? new Prisma.Decimal(0));
      const amount = new Prisma.Decimal(parsed.data.amount);
      if (amount.greaterThan(remaining)) throw new Error("REFUND_EXCEEDS_BALANCE");

      const refund = await transaction.refund.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          orderId: order.id,
          registerShiftId: null,
          createdById: membership.userId,
          amount,
          cashRefundAmount: amount,
          reason: parsed.data.reason,
          idempotencyKey: parsed.data.idempotencyKey,
        },
      });
      const giftCardRefund = await restoreGiftCardForRefund(transaction, {
        organizationId: organization.id,
        orderId: order.id,
        orderTotal: order.total,
        giftCardId: order.giftCardId,
        giftCardRedeemed: order.giftCardRedeemed,
        cumulativeRefund: (priorRefunds._sum.amount ?? new Prisma.Decimal(0)).plus(amount),
        refundId: refund.id,
        actorId: membership.userId,
      });
      const cashRefundAmount = amount.minus(giftCardRefund);
      let shiftId: string | null = null;
      if (cashRefundAmount.greaterThan(0)) {
        const [shift] = await transaction.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "RegisterShift"
          WHERE "organizationId" = ${organization.id}
            AND "storeId" = ${store.id}
            AND "registerId" = ${register.id}
            AND "closedAt" IS NULL
          ORDER BY "openedAt" DESC
          LIMIT 1
          FOR UPDATE
        `;
        if (!shift) throw new Error("REGISTER_SHIFT_NOT_OPEN");
        shiftId = shift.id;
      }
      await transaction.refund.update({
        where: { id: refund.id },
        data: { cashRefundAmount, registerShiftId: shiftId },
      });
      await reverseCustomerLoyaltyForRefund(transaction, {
        organizationId: organization.id,
        customerId: order.customerId,
        orderId: order.id,
        refundId: refund.id,
        orderTotal: order.total,
        pointsEarned: Number(order.loyaltyPointsEarned),
        pointsRedeemed: Number(order.loyaltyPointsRedeemed),
        cumulativeRefund: (priorRefunds._sum.amount ?? new Prisma.Decimal(0)).plus(amount),
        actorId: membership.userId,
      });
      const fullyRefunded = amount.equals(remaining);
      await transaction.payment.updateMany({
        where: { orderId: order.id, status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED] } },
        data: { status: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED },
      });
      await transaction.order.update({
        where: { id: order.id },
        data: { status: fullyRefunded ? OrderStatus.REFUNDED : OrderStatus.PARTIALLY_REFUNDED },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "pos.refund_issued",
          entityType: "Order",
          entityId: order.id,
          details: { number: order.number, amount: amount.toString(), cashRefundAmount: cashRefundAmount.toString(), giftCardRefundAmount: giftCardRefund.toString(), reason: parsed.data.reason, shiftId },
        },
      });
    });

    revalidatePath("/pos/transactions");
    revalidatePath(`/pos/receipt/${parsed.data.orderId}`);
    revalidatePath("/register-shifts");
    revalidatePath("/gift-cards");
    revalidatePath("/customers");
    return { status: "success", message: "Refund recorded. Any gift-card-funded value was restored to the original gift card." };
  } catch (error) {
    if (error instanceof Error && error.message === "SALE_NOT_REFUNDABLE") return { status: "error", message: "Only paid or partially refunded sales can be refunded." };
    if (error instanceof Error && error.message === "REGISTER_SHIFT_NOT_OPEN") return { status: "error", message: "Open a register shift to record the cash refund." };
    if (error instanceof Error && error.message === "REFUND_EXCEEDS_BALANCE") return { status: "error", message: "Refund amount exceeds the remaining refundable balance." };
    if (error instanceof Error && error.message === "GIFT_CARD_REFUND_INCONSISTENT") return { status: "error", message: "Gift card refund history is inconsistent. No refund was recorded." };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "error", message: "This refund request was already recorded." };
    console.error("Refund failed.", error);
    return { status: "error", message: "The refund could not be recorded. Please try again." };
  }
}

export async function returnSaleItems(
  _previousState: PosActionState,
  formData: FormData,
): Promise<PosActionState> {
  const parsed = saleReturnSchema.safeParse({
    orderId: formData.get("orderId"),
    reason: formData.get("reason"),
    idempotencyKey: formData.get("idempotencyKey"),
    lines: parseJson(formData.get("lines")),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the returned items." };
  const { organization, membership, store, register } = await getWorkspace({ feature: "pos", operation: "change" });
  if (!canManagePricing(membership.role)) return { status: "error", message: "Only an owner or manager can process sale returns." };
  if (!register) return { status: "error", message: "You do not have access to an active POS register at this store." };

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Order"
        WHERE "id" = ${parsed.data.orderId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
        FOR UPDATE
      `;
      const priorRequest = await transaction.refund.findUnique({
        where: { idempotencyKey: parsed.data.idempotencyKey, organizationId: organization.id },
        select: { id: true },
      });
      if (priorRequest) return;

      const order = await transaction.order.findFirst({
        where: {
          id: parsed.data.orderId,
          organizationId: organization.id,
          storeId: store.id,
          status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED] },
        },
        include: {
          items: {
            where: { id: { in: parsed.data.lines.map((line) => line.itemId) } },
            include: { variant: { select: { trackInventory: true } } },
          },
        },
      });
      if (!order || order.items.length !== parsed.data.lines.length) throw new Error("SALE_RETURN_LINE_NOT_FOUND");

      const priorItems = await transaction.saleReturnItem.findMany({
        where: { orderItemId: { in: order.items.map((item) => item.id) } },
        select: { orderItemId: true, quantity: true },
      });
      const returnedByItem = new Map<string, number>();
      for (const prior of priorItems) returnedByItem.set(prior.orderItemId, (returnedByItem.get(prior.orderItemId) ?? 0) + prior.quantity);

      let refundCents = 0n;
      const returnLines = parsed.data.lines.map((line) => {
        const item = order.items.find((candidate) => candidate.id === line.itemId);
        if (!item) throw new Error("SALE_RETURN_LINE_NOT_FOUND");
        const alreadyReturned = returnedByItem.get(item.id) ?? 0;
        if (alreadyReturned + line.quantity > item.quantity) throw new Error("SALE_RETURN_QUANTITY_INVALID");
        if (item.lineTotal.lessThanOrEqualTo(0)) throw new Error("SALE_RETURN_NO_VALUE");
        const amountCents = returnedLineRefundCents(
          decimalToCents(item.lineTotal.toFixed(2)),
          item.quantity,
          alreadyReturned,
          line.quantity,
        );
        if (line.restock && (!item.variantId || !item.variant?.trackInventory)) throw new Error("SALE_RETURN_CANNOT_RESTOCK");
        refundCents += amountCents;
        return { ...line, item, amount: centsToDecimal(amountCents) };
      });
      if (refundCents < 1n) throw new Error("SALE_RETURN_NO_VALUE");

      const priorRefunds = await transaction.refund.aggregate({ where: { orderId: order.id }, _sum: { amount: true } });
      const remaining = order.total.minus(priorRefunds._sum.amount ?? new Prisma.Decimal(0));
      const refundAmount = new Prisma.Decimal(centsToDecimal(refundCents));
      if (refundAmount.greaterThan(remaining)) throw new Error("REFUND_EXCEEDS_BALANCE");

      const trackedIds = returnLines.filter((line) => line.restock).map((line) => line.item.variantId).filter((id): id is string => id !== null);
      if (trackedIds.length) {
        await transaction.$queryRaw`
          SELECT "id" FROM "InventoryLevel"
          WHERE "organizationId" = ${organization.id}
            AND "storeId" = ${store.id}
            AND "variantId" IN (${Prisma.join(trackedIds)})
          ORDER BY "variantId"
          FOR UPDATE
        `;
      }

      const refund = await transaction.refund.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          orderId: order.id,
          registerShiftId: null,
          createdById: membership.userId,
          amount: refundAmount,
          cashRefundAmount: refundAmount,
          reason: parsed.data.reason,
          idempotencyKey: parsed.data.idempotencyKey,
        },
      });
      const giftCardRefund = await restoreGiftCardForRefund(transaction, {
        organizationId: organization.id,
        orderId: order.id,
        orderTotal: order.total,
        giftCardId: order.giftCardId,
        giftCardRedeemed: order.giftCardRedeemed,
        cumulativeRefund: (priorRefunds._sum.amount ?? new Prisma.Decimal(0)).plus(refundAmount),
        refundId: refund.id,
        actorId: membership.userId,
      });
      const cashRefundAmount = refundAmount.minus(giftCardRefund);
      let shiftId: string | null = null;
      if (cashRefundAmount.greaterThan(0)) {
        const [shift] = await transaction.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "RegisterShift"
          WHERE "organizationId" = ${organization.id}
            AND "storeId" = ${store.id}
            AND "registerId" = ${register.id}
            AND "closedAt" IS NULL
          ORDER BY "openedAt" DESC
          LIMIT 1
          FOR UPDATE
        `;
        if (!shift) throw new Error("REGISTER_SHIFT_NOT_OPEN");
        shiftId = shift.id;
      }
      await transaction.refund.update({
        where: { id: refund.id },
        data: { cashRefundAmount, registerShiftId: shiftId },
      });
      await reverseCustomerLoyaltyForRefund(transaction, {
        organizationId: organization.id,
        customerId: order.customerId,
        orderId: order.id,
        refundId: refund.id,
        orderTotal: order.total,
        pointsEarned: Number(order.loyaltyPointsEarned),
        pointsRedeemed: Number(order.loyaltyPointsRedeemed),
        cumulativeRefund: (priorRefunds._sum.amount ?? new Prisma.Decimal(0)).plus(refundAmount),
        actorId: membership.userId,
      });
      const saleReturn = await transaction.saleReturn.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          orderId: order.id,
          refundId: refund.id,
          createdById: membership.userId,
          reason: parsed.data.reason,
          items: {
            create: returnLines.map((line) => ({
              orderItemId: line.item.id,
              quantity: line.quantity,
              restocked: line.restock,
              refunded: line.amount,
            })),
          },
        },
      });
      for (const line of returnLines) {
        if (!line.restock || !line.item.variantId) continue;
        const level = await transaction.inventoryLevel.findFirst({
          where: { organizationId: organization.id, storeId: store.id, variantId: line.item.variantId },
          select: { id: true },
        });
        if (!level) throw new Error("SALE_RETURN_STOCK_RECORD_MISSING");
        await transaction.inventoryLevel.update({
          where: { id: level.id },
          data: { quantity: { increment: line.quantity } },
        });
        await transaction.inventoryMovement.create({
          data: {
            organizationId: organization.id,
            storeId: store.id,
            variantId: line.item.variantId,
            createdById: membership.userId,
            type: InventoryMovementType.RETURN,
            quantityDelta: line.quantity,
            reason: `Customer return for sale #${order.number}: ${parsed.data.reason}`,
            reference: saleReturn.id,
          },
        });
      }
      const fullyRefunded = refundAmount.equals(remaining);
      await transaction.payment.updateMany({
        where: { orderId: order.id, status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED] } },
        data: { status: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED },
      });
      await transaction.order.update({
        where: { id: order.id },
        data: { status: fullyRefunded ? OrderStatus.REFUNDED : OrderStatus.PARTIALLY_REFUNDED },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "pos.sale_return_processed",
          entityType: "SaleReturn",
          entityId: saleReturn.id,
          details: {
            orderId: order.id,
            orderNumber: order.number,
            refundAmount: refundAmount.toString(),
            cashRefundAmount: cashRefundAmount.toString(),
            giftCardRefundAmount: giftCardRefund.toString(),
            reason: parsed.data.reason,
            items: returnLines.map((line) => ({ itemId: line.item.id, quantity: line.quantity, restocked: line.restock, refunded: line.amount.toString() })),
          },
        },
      });
    });
    revalidatePath("/pos/transactions");
    revalidatePath(`/pos/receipt/${parsed.data.orderId}`);
    revalidatePath("/register-shifts");
    revalidatePath("/gift-cards");
    revalidatePath("/inventory");
    revalidatePath("/customers");
    return { status: "success", message: "Sale return recorded. Gift-card-funded value was restored to the original card." };
  } catch (error) {
    if (error instanceof Error && error.message === "SALE_RETURN_LINE_NOT_FOUND") return { status: "error", message: "One or more sale items are unavailable. Refresh and try again." };
    if (error instanceof Error && error.message === "SALE_RETURN_QUANTITY_INVALID") return { status: "error", message: "Return quantity exceeds the remaining quantity on the sale." };
    if (error instanceof Error && error.message === "REGISTER_SHIFT_NOT_OPEN") return { status: "error", message: "Open a register shift to record the cash refund." };
    if (error instanceof Error && error.message === "SALE_RETURN_CANNOT_RESTOCK") return { status: "error", message: "Only tracked product variants can be returned to inventory." };
    if (error instanceof Error && error.message === "SALE_RETURN_STOCK_RECORD_MISSING") return { status: "error", message: "An inventory record is missing; the return was not recorded." };
    if (error instanceof Error && error.message === "REFUND_EXCEEDS_BALANCE") return { status: "error", message: "Returned-item refund exceeds the remaining refundable balance." };
    if (error instanceof Error && error.message === "SALE_RETURN_NO_VALUE") return { status: "error", message: "The selected returned items do not have a refundable value." };
    if (error instanceof Error && error.message === "GIFT_CARD_REFUND_INCONSISTENT") return { status: "error", message: "Gift card refund history is inconsistent. No return was recorded." };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "error", message: "This return request was already recorded." };
    console.error("Sale return failed.", error);
    return { status: "error", message: "The sale return could not be recorded. Please try again." };
  }
}

export async function updateTaxSettings(
  _previousState: PosActionState,
  formData: FormData,
): Promise<PosActionState> {
  const parsed = taxSettingsSchema.safeParse({
    vat: formData.get("vat"),
    nhil: formData.get("nhil"),
    getfund: formData.get("getfund"),
    effectiveFrom: formData.get("effectiveFrom"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter valid tax settings." };
  const { organization, membership } = await getWorkspace({ feature: "pos", operation: "change" });
  if (!canManagePricing(membership.role)) return { status: "error", message: "Only an owner or manager can change tax settings." };

  try {
    const effectiveFrom = new Date(`${parsed.data.effectiveFrom}T00:00:00.000Z`);
    const components = [
      { component: TaxComponent.VAT, rate: parsed.data.vat },
      { component: TaxComponent.NHIL, rate: parsed.data.nhil },
      { component: TaxComponent.GETFUND, rate: parsed.data.getfund },
    ];
    await prisma.$transaction(async (transaction) => {
      for (const { component, rate } of components) {
        await transaction.taxRateSetting.upsert({
          where: { organizationId_component_effectiveFrom: { organizationId: organization.id, component, effectiveFrom } },
          create: { organizationId: organization.id, component, rate: new Prisma.Decimal(rate), effectiveFrom, createdById: membership.userId },
          update: { rate: new Prisma.Decimal(rate), createdById: membership.userId },
        });
      }
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "organization.tax_settings_updated",
          entityType: "Organization",
          entityId: organization.id,
          details: {
            effectiveFrom: parsed.data.effectiveFrom,
            vat: parsed.data.vat,
            nhil: parsed.data.nhil,
            getfund: parsed.data.getfund,
          },
        },
      });
    });
    revalidatePath("/pos");
    revalidatePath("/settings");
    return { status: "success", message: "Tax rates saved from the effective date. Held carts snapshot them when next saved; completed sales are unchanged." };
  } catch (error) {
    console.error("Tax settings update failed.", error);
    return { status: "error", message: "The tax settings could not be updated. Please try again." };
  }
}
export async function voidSale(
  _previousState: PosActionState,
  formData: FormData,
): Promise<PosActionState> {
  const parsed = voidSaleSchema.safeParse({
    orderId: formData.get("orderId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the void details." };
  const { organization, membership, store, register } = await getWorkspace({ feature: "pos", operation: "change" });
  if (!canManagePricing(membership.role)) return { status: "error", message: "Only an owner or manager can void a held sale." };
  if (!register) return { status: "error", message: "You do not have access to an active POS register at this store." };

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Order"
        WHERE "id" = ${parsed.data.orderId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
        FOR UPDATE
      `;
      const order = await transaction.order.findFirst({
        where: {
          id: parsed.data.orderId,
          organizationId: organization.id,
          storeId: store.id,
          status: OrderStatus.DRAFT,
          registerShift: { is: { registerId: register.id } },
        },
        select: { id: true, number: true },
      });
      if (!order) throw new Error("SALE_DRAFT_UNAVAILABLE");
      await releaseDraftReservations(transaction, organization.id, store.id, order.id);
      await transaction.order.update({ where: { id: order.id }, data: { status: OrderStatus.CANCELLED } });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "pos.sale_voided",
          entityType: "Order",
          entityId: order.id,
          details: { number: order.number, reason: parsed.data.reason },
        },
      });
    });
    revalidatePath("/pos");
    revalidatePath("/pos/transactions");
    return { status: "success", message: "Held sale voided." };
  } catch (error) {
    if (error instanceof Error && error.message === "SALE_DRAFT_UNAVAILABLE") return { status: "error", message: "That sale is no longer an uncompleted held cart." };
    if (error instanceof Error && error.message === "SALE_RESERVATION_STOCK_MISSING") return { status: "error", message: "An inventory record is missing; the held cart was not voided." };
    if (error instanceof Error && error.message === "SALE_RESERVATION_INCONSISTENT") return { status: "error", message: "Stock reservation data is inconsistent. Contact an administrator before voiding this cart." };
    console.error("Sale void failed.", error);
    return { status: "error", message: "The held sale could not be voided. Please try again." };
  }
}
