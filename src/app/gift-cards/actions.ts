"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { canManagePricing } from "@/lib/permissions";
import { generateGiftCardCode, giftCardExpiryIsValid } from "@/lib/gift-cards";
import { businessDateInTimeZone } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { giftCardIssueSchema, giftCardStatusSchema } from "@/lib/validation";

export type GiftCardActionState = {
  status: "idle" | "error" | "success";
  message: string;
  code?: string;
};

export async function issueGiftCard(
  _previousState: GiftCardActionState,
  formData: FormData,
): Promise<GiftCardActionState> {
  const parsed = giftCardIssueSchema.safeParse({
    amount: formData.get("amount"),
    expiresOn: formData.get("expiresOn") || "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the gift card details." };
  const { organization, membership } = await getWorkspace({ feature: "giftCards", operation: "change" });
  if (!canManagePricing(membership.role)) return { status: "error", message: "Only an owner or manager can issue gift cards." };
  const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
  if (!giftCardExpiryIsValid(parsed.data.expiresOn, businessDate)) {
    return { status: "error", message: "Expiry date cannot be before the organization's business date." };
  }

  try {
    const issued = generateGiftCardCode();
    const card = await prisma.$transaction(async (transaction) => {
      const created = await transaction.giftCard.create({
        data: {
          organizationId: organization.id,
          codeHash: issued.codeHash,
          codeLastFour: issued.code.slice(-4),
          initialBalance: new Prisma.Decimal(parsed.data.amount),
          balance: new Prisma.Decimal(parsed.data.amount),
          expiresAt: parsed.data.expiresOn ? new Date(`${parsed.data.expiresOn}T00:00:00.000Z`) : null,
          createdById: membership.userId,
        },
      });
      await transaction.giftCardTransaction.create({
        data: {
          organizationId: organization.id,
          giftCardId: created.id,
          type: "ISSUE",
          amountDelta: created.initialBalance,
          createdById: membership.userId,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "gift_card.issued",
          entityType: "GiftCard",
          entityId: created.id,
          details: {
            lastFour: created.codeLastFour,
            initialBalance: created.initialBalance.toString(),
            expiresAt: created.expiresAt?.toISOString().slice(0, 10) ?? null,
          },
        },
      });
      return created;
    });

    revalidatePath("/gift-cards");
    revalidatePath("/pos");
    return { status: "success", message: `Gift card issued with ${organization.currency} ${card.initialBalance.toFixed(2)}. Copy the code now; it cannot be shown again.`, code: issued.code };
  } catch (error) {
    console.error("Gift card issuance failed.", error);
    return { status: "error", message: "The gift card could not be issued. Please try again." };
  }
}

export async function setGiftCardActive(
  _previousState: GiftCardActionState,
  formData: FormData,
): Promise<GiftCardActionState> {
  const parsed = giftCardStatusSchema.safeParse({
    giftCardId: formData.get("giftCardId"),
    active: formData.get("active"),
  });
  if (!parsed.success) return { status: "error", message: "That gift card status request is invalid." };
  const { organization, membership } = await getWorkspace({ feature: "giftCards", operation: "change" });
  if (!canManagePricing(membership.role)) return { status: "error", message: "Only an owner or manager can change gift card status." };
  const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
  const businessDateStart = new Date(`${businessDate}T00:00:00.000Z`);

  try {
    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.giftCard.updateMany({
        where: {
          id: parsed.data.giftCardId,
          organizationId: organization.id,
          ...(parsed.data.active
            ? {
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gte: businessDateStart } },
                ],
              }
            : {}),
        },
        data: { active: parsed.data.active },
      });
      if (updated.count !== 1) {
        if (parsed.data.active) {
          const card = await transaction.giftCard.findFirst({
            where: { id: parsed.data.giftCardId, organizationId: organization.id },
            select: { expiresAt: true },
          });
          if (card && !giftCardExpiryIsValid(card.expiresAt?.toISOString().slice(0, 10) ?? null, businessDate)) {
            throw new Error("GIFT_CARD_EXPIRED");
          }
        }
        throw new Error("GIFT_CARD_NOT_AVAILABLE");
      }
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: parsed.data.active ? "gift_card.activated" : "gift_card.deactivated",
          entityType: "GiftCard",
          entityId: parsed.data.giftCardId,
        },
      });
    });
    revalidatePath("/gift-cards");
    revalidatePath("/pos");
    return { status: "success", message: parsed.data.active ? "Gift card activated." : "Gift card deactivated." };
  } catch (error) {
    if (error instanceof Error && error.message === "GIFT_CARD_EXPIRED") return { status: "error", message: "Expired gift cards cannot be reactivated." };
    if (error instanceof Error && error.message === "GIFT_CARD_NOT_AVAILABLE") return { status: "error", message: "That gift card is no longer available. Refresh and try again." };
    console.error("Gift card status update failed.", error);
    return { status: "error", message: "Gift card status could not be changed. Please try again." };
  }
}
