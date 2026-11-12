"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { canManagePricing } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getMutationWorkspace } from "@/lib/workspace";
import { promotionInputSchema, promotionStatusSchema } from "@/lib/validation";

export type PromotionActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

export async function createPromotion(
  _previousState: PromotionActionState,
  formData: FormData,
): Promise<PromotionActionState> {
  const parsed = promotionInputSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    type: formData.get("type"),
    value: formData.get("value"),
    maxRedemptions: formData.get("maxRedemptions") || "",
    productIds: formData.getAll("productIds"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the promotion details." };

  const { organization, membership } = await getMutationWorkspace(formData, { feature: "promotions", operation: "change" });
  if (!canManagePricing(membership.role)) {
    return { status: "error", message: "Only an owner or manager can create promotions." };
  }

  try {
    const promotion = await prisma.$transaction(async (transaction) => {
      if (parsed.data.productIds.length) {
        const activeProducts = await transaction.product.count({
          where: {
            organizationId: organization.id,
            id: { in: parsed.data.productIds },
            archivedAt: null,
          },
        });
        if (activeProducts !== parsed.data.productIds.length) throw new Error("PROMOTION_PRODUCT_UNAVAILABLE");
      }
      const created = await transaction.promotion.create({
        data: {
          organizationId: organization.id,
          name: parsed.data.name,
          code: parsed.data.code,
          type: parsed.data.type,
          value: new Prisma.Decimal(parsed.data.value),
          minimumSubtotal: new Prisma.Decimal(parsed.data.minimumSubtotal),
          startsOn: parsed.data.startsOn ? new Date(`${parsed.data.startsOn}T00:00:00.000Z`) : null,
          endsOn: parsed.data.endsOn ? new Date(`${parsed.data.endsOn}T00:00:00.000Z`) : null,
          maxRedemptions: parsed.data.maxRedemptions,
          products: parsed.data.productIds.length
            ? {
                create: parsed.data.productIds.map((productId) => ({
                  organizationId: organization.id,
                  productId,
                })),
              }
            : undefined,
        },
        include: { products: { select: { productId: true } } },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "promotion.created",
          entityType: "Promotion",
          entityId: created.id,
          details: {
            code: created.code,
            type: created.type,
            value: created.value.toString(),
            minimumSubtotal: created.minimumSubtotal.toString(),
            startsOn: created.startsOn?.toISOString().slice(0, 10) ?? null,
            endsOn: created.endsOn?.toISOString().slice(0, 10) ?? null,
            maxRedemptions: created.maxRedemptions,
            productIds: created.products.map(({ productId }) => productId),
          },
        },
      });
      return created;
    });

    revalidatePath("/promotions");
    revalidatePath("/pos");
    return { status: "success", message: `${promotion.name} (${promotion.code}) is ready to use.` };
  } catch (error) {
    if (error instanceof Error && error.message === "PROMOTION_PRODUCT_UNAVAILABLE") {
      return { status: "error", message: "One or more selected products are unavailable. Refresh and try again." };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "That promotion code is already in use in your business." };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return { status: "error", message: "One or more selected products are unavailable. Refresh and try again." };
    }
    console.error("Promotion creation failed.", error);
    return { status: "error", message: "The promotion could not be saved. Please try again." };
  }
}

export async function setPromotionActive(
  _previousState: PromotionActionState,
  formData: FormData,
): Promise<PromotionActionState> {
  const parsed = promotionStatusSchema.safeParse({
    promotionId: formData.get("promotionId"),
    active: formData.get("active"),
  });
  if (!parsed.success) return { status: "error", message: "That promotion status request is invalid." };

  const { organization, membership } = await getMutationWorkspace(formData, { feature: "promotions", operation: "change" });
  if (!canManagePricing(membership.role)) {
    return { status: "error", message: "Only an owner or manager can change promotion status." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.promotion.updateMany({
        where: { id: parsed.data.promotionId, organizationId: organization.id },
        data: { active: parsed.data.active },
      });
      if (updated.count !== 1) throw new Error("PROMOTION_NOT_AVAILABLE");

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: parsed.data.active ? "promotion.activated" : "promotion.deactivated",
          entityType: "Promotion",
          entityId: parsed.data.promotionId,
        },
      });
    });
    revalidatePath("/promotions");
    revalidatePath("/pos");
    return { status: "success", message: parsed.data.active ? "Promotion activated." : "Promotion deactivated." };
  } catch (error) {
    if (error instanceof Error && error.message === "PROMOTION_NOT_AVAILABLE") {
      return { status: "error", message: "That promotion is no longer available. Refresh and try again." };
    }
    console.error("Promotion status update failed.", error);
    return { status: "error", message: "Promotion status could not be changed. Please try again." };
  }
}
