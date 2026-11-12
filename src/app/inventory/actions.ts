"use server";

import { InventoryMovementType, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { canManageCatalog } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getMutationWorkspace } from "@/lib/workspace";
import { damagedStockSchema, inventoryAdjustmentSchema, inventoryCountSchema, inventoryReorderPointSchema, stockTransferSchema } from "@/lib/validation";

export type InventoryActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

export async function adjustInventory(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const parsed = inventoryAdjustmentSchema.safeParse({
    variantId: formData.get("variantId"),
    quantityDelta: formData.get("quantityDelta"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the stock adjustment." };
  }

  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot adjust stock." };
  }
  const { variantId, quantityDelta, reason } = parsed.data;

  try {
    await prisma.$transaction(async (transaction) => {
      const level = await transaction.inventoryLevel.findFirst({
        where: {
          organizationId: organization.id,
          storeId: store.id,
          variantId,
        },
        include: {
          variant: { include: { product: true } },
        },
      });

      if (!level) throw new Error("STOCK_ITEM_NOT_FOUND");
      if (level.variant.product.archivedAt) throw new Error("PRODUCT_ARCHIVED");
      if (!organization.allowNegativeStock && level.quantity - level.reserved + quantityDelta < 0) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      const update = await transaction.inventoryLevel.updateMany({
        where: {
          id: level.id,
          ...(!organization.allowNegativeStock && quantityDelta < 0
            ? { quantity: { gte: level.reserved + Math.abs(quantityDelta) } }
            : {}),
        },
        data: { quantity: { increment: quantityDelta } },
      });

      if (update.count !== 1) throw new Error("INSUFFICIENT_STOCK");

      await transaction.inventoryMovement.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          variantId,
          createdById: membership.userId,
          type: InventoryMovementType.ADJUSTMENT,
          quantityDelta,
          reason,
        },
      });

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "inventory.adjusted",
          entityType: "InventoryLevel",
          entityId: level.id,
          details: {
            productName: level.variant.product.name,
            sku: level.variant.sku,
            quantityDelta,
            reason,
            resultingQuantity: level.quantity + quantityDelta,
          },
        },
      });
    });

    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { status: "success", message: "Stock adjustment recorded." };
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") {
      return { status: "error", message: "This adjustment would make available stock negative." };
    }
    if (error instanceof Error && error.message === "STOCK_ITEM_NOT_FOUND") {
      return { status: "error", message: "That stock item is not available in your active store." };
    }
    if (error instanceof Error && error.message === "PRODUCT_ARCHIVED") {
      return { status: "error", message: "Archived products cannot be adjusted. Restore the product first." };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { status: "error", message: "That stock item is no longer available. Refresh and try again." };
    }

    console.error("Inventory adjustment failed.", error);
    return { status: "error", message: "The stock adjustment could not be saved. Please try again." };
  }
}

export async function updateInventoryReorderPoint(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const parsed = inventoryReorderPointSchema.safeParse({
    variantId: formData.get("variantId"),
    expectedReorderPoint: formData.get("expectedReorderPoint"),
    reorderPoint: formData.get("reorderPoint"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the reorder point." };
  }

  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot update reorder points." };
  }
  const { variantId, expectedReorderPoint, reorderPoint } = parsed.data;

  try {
    await prisma.$transaction(async (transaction) => {
      const level = await transaction.inventoryLevel.findFirst({
        where: { organizationId: organization.id, storeId: store.id, variantId },
        include: { variant: { include: { product: true } } },
      });
      if (!level || level.variant.product.archivedAt) throw new Error("REORDER_STOCK_ITEM_UNAVAILABLE");

      const update = await transaction.inventoryLevel.updateMany({
        where: {
          id: level.id,
          organizationId: organization.id,
          storeId: store.id,
          reorderPoint: expectedReorderPoint,
        },
        data: { reorderPoint },
      });
      if (update.count !== 1) throw new Error("REORDER_POINT_CHANGED");

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "inventory.reorder_point_updated",
          entityType: "InventoryLevel",
          entityId: level.id,
          details: {
            productName: level.variant.product.name,
            sku: level.variant.sku,
            storeId: store.id,
            previousReorderPoint: level.reorderPoint,
            reorderPoint,
          },
        },
      });
    });

    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { status: "success", message: "Reorder point updated." };
  } catch (error) {
    if (error instanceof Error && error.message === "REORDER_STOCK_ITEM_UNAVAILABLE") {
      return { status: "error", message: "That stock item is unavailable in your active store." };
    }
    if (error instanceof Error && error.message === "REORDER_POINT_CHANGED") {
      return { status: "error", message: "The reorder point changed elsewhere. Refresh and try again." };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { status: "error", message: "That stock item is no longer available. Refresh and try again." };
    }

    console.error("Inventory reorder point update failed.", error);
    return { status: "error", message: "The reorder point could not be saved. Please try again." };
  }
}

export async function writeOffDamagedStock(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const parsed = damagedStockSchema.safeParse({
    variantId: formData.get("variantId"),
    quantity: formData.get("quantity"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the damaged-stock details." };
  }

  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot write off damaged stock." };
  }
  const { variantId, quantity, reason } = parsed.data;

  try {
    await prisma.$transaction(async (transaction) => {
      const level = await transaction.inventoryLevel.findFirst({
        where: { organizationId: organization.id, storeId: store.id, variantId },
        include: { variant: { include: { product: true } } },
      });
      if (!level || level.variant.product.archivedAt) throw new Error("DAMAGE_STOCK_ITEM_NOT_FOUND");

      const update = await transaction.inventoryLevel.updateMany({
        where: {
          id: level.id,
          organizationId: organization.id,
          storeId: store.id,
          quantity: { gte: level.reserved + quantity },
          reserved: level.reserved,
        },
        data: { quantity: { decrement: quantity } },
      });
      if (update.count !== 1) throw new Error("DAMAGE_INSUFFICIENT_AVAILABLE_STOCK");

      await transaction.inventoryMovement.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          variantId,
          createdById: membership.userId,
          type: InventoryMovementType.DAMAGE,
          quantityDelta: -quantity,
          reason: `Damaged stock: ${reason}`,
          reference: level.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "inventory.damaged_stock_written_off",
          entityType: "InventoryLevel",
          entityId: level.id,
          details: {
            productName: level.variant.product.name,
            sku: level.variant.sku,
            quantity,
            reason,
            resultingQuantity: level.quantity - quantity,
          },
        },
      });
    });

    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { status: "success", message: `${quantity} damaged unit${quantity === 1 ? "" : "s"} written off.` };
  } catch (error) {
    if (error instanceof Error && error.message === "DAMAGE_STOCK_ITEM_NOT_FOUND") {
      return { status: "error", message: "That stock item is no longer available in your active store." };
    }
    if (error instanceof Error && error.message === "DAMAGE_INSUFFICIENT_AVAILABLE_STOCK") {
      return { status: "error", message: "The write-off cannot reduce stock below the quantity reserved for orders." };
    }
    console.error("Damaged stock write-off failed.", error);
    return { status: "error", message: "The damaged stock could not be written off. Please try again." };
  }
}

export async function reconcileInventoryCount(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const parsed = inventoryCountSchema.safeParse({
    variantId: formData.get("variantId"),
    expectedQuantity: formData.get("expectedQuantity"),
    countedQuantity: formData.get("countedQuantity"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the physical count." };
  }

  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot reconcile stock counts." };
  }
  const { variantId, expectedQuantity, countedQuantity, reason } = parsed.data;
  const quantityDelta = countedQuantity - expectedQuantity;
  let unchanged = false;

  try {
    await prisma.$transaction(async (transaction) => {
      const level = await transaction.inventoryLevel.findFirst({
        where: { organizationId: organization.id, storeId: store.id, variantId },
        include: { variant: { include: { product: true } } },
      });
      if (!level || level.variant.product.archivedAt) throw new Error("STOCK_ITEM_NOT_FOUND");
      if (countedQuantity < level.reserved) throw new Error("COUNT_BELOW_RESERVED");
      if (level.quantity !== expectedQuantity) throw new Error("COUNT_STALE");
      if (quantityDelta === 0) {
        unchanged = true;
        return;
      }

      const updated = await transaction.inventoryLevel.updateMany({
        where: {
          id: level.id,
          organizationId: organization.id,
          storeId: store.id,
          quantity: expectedQuantity,
          reserved: { lte: countedQuantity },
        },
        data: { quantity: countedQuantity },
      });
      if (updated.count !== 1) throw new Error("COUNT_STALE");

      await transaction.inventoryMovement.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          variantId,
          createdById: membership.userId,
          type: InventoryMovementType.ADJUSTMENT,
          quantityDelta,
          reason: `Cycle count: ${reason}`,
          reference: level.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "inventory.count_reconciled",
          entityType: "InventoryLevel",
          entityId: level.id,
          details: {
            productName: level.variant.product.name,
            sku: level.variant.sku,
            expectedQuantity,
            countedQuantity,
            quantityDelta,
            reason,
          },
        },
      });
    });

    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    if (unchanged) {
      return { status: "success", message: "Count matches the current stock; no adjustment was needed." };
    }
    return { status: "success", message: `Count reconciled with a ${quantityDelta > 0 ? "+" : ""}${quantityDelta} unit adjustment.` };
  } catch (error) {
    if (error instanceof Error && error.message === "COUNT_BELOW_RESERVED") {
      return { status: "error", message: "The count cannot be below the quantity reserved for orders." };
    }
    if (error instanceof Error && error.message === "COUNT_STALE") {
      return { status: "error", message: "Stock changed after this count was opened. Refresh and recount before reconciling." };
    }
    if (error instanceof Error && error.message === "STOCK_ITEM_NOT_FOUND") {
      return { status: "error", message: "That stock item is no longer available in your active store." };
    }
    console.error("Inventory count reconciliation failed.", error);
    return { status: "error", message: "The stock count could not be reconciled. Please try again." };
  }
}

export async function transferInventory(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const parsed = stockTransferSchema.safeParse({
    variantId: formData.get("variantId"),
    toStoreId: formData.get("toStoreId"),
    quantity: formData.get("quantity"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the transfer details." };
  }

  const { organization, membership, store: sourceStore } = await getMutationWorkspace(formData, { feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot transfer stock." };
  }
  const { variantId, toStoreId, quantity, reason } = parsed.data;
  if (toStoreId === sourceStore.id) {
    return { status: "error", message: "Choose a destination different from the active source store." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      const targetStore = await transaction.store.findFirst({
        where: { id: toStoreId, organizationId: organization.id, active: true },
        select: { id: true, name: true },
      });
      if (!targetStore) throw new Error("TRANSFER_STORE_NOT_AVAILABLE");

      const variant = await transaction.productVariant.findFirst({
        where: { id: variantId, organizationId: organization.id, product: { archivedAt: null } },
        select: { id: true, sku: true, product: { select: { name: true } } },
      });
      if (!variant) throw new Error("TRANSFER_VARIANT_NOT_AVAILABLE");

      await transaction.$queryRaw`
        SELECT "id" FROM "InventoryLevel"
        WHERE "organizationId" = ${organization.id}
          AND "variantId" = ${variantId}
          AND "storeId" IN (${sourceStore.id}, ${targetStore.id})
        ORDER BY "storeId"
        FOR UPDATE
      `;
      const sourceLevel = await transaction.inventoryLevel.findFirst({
        where: { organizationId: organization.id, storeId: sourceStore.id, variantId },
      });
      if (!sourceLevel) throw new Error("TRANSFER_SOURCE_STOCK_MISSING");
      if (sourceLevel.quantity - sourceLevel.reserved < quantity) throw new Error("TRANSFER_INSUFFICIENT_STOCK");

      const transfer = await transaction.stockTransfer.create({
        data: {
          organizationId: organization.id,
          fromStoreId: sourceStore.id,
          toStoreId: targetStore.id,
          variantId,
          createdById: membership.userId,
          quantity,
          reason,
        },
      });
      const decremented = await transaction.inventoryLevel.updateMany({
        where: {
          id: sourceLevel.id,
          organizationId: organization.id,
          storeId: sourceStore.id,
          quantity: { gte: sourceLevel.reserved + quantity },
          reserved: sourceLevel.reserved,
        },
        data: { quantity: { decrement: quantity } },
      });
      if (decremented.count !== 1) throw new Error("TRANSFER_INSUFFICIENT_STOCK");

      await transaction.inventoryLevel.upsert({
        where: { storeId_variantId: { storeId: targetStore.id, variantId } },
        create: {
          organizationId: organization.id,
          storeId: targetStore.id,
          variantId,
          quantity,
        },
        update: { quantity: { increment: quantity } },
      });
      await transaction.inventoryMovement.createMany({
        data: [
          {
            organizationId: organization.id,
            storeId: sourceStore.id,
            variantId,
            createdById: membership.userId,
            type: InventoryMovementType.TRANSFER_OUT,
            quantityDelta: -quantity,
            reason: `Transfer to ${targetStore.name}: ${reason}`,
            reference: transfer.id,
          },
          {
            organizationId: organization.id,
            storeId: targetStore.id,
            variantId,
            createdById: membership.userId,
            type: InventoryMovementType.TRANSFER_IN,
            quantityDelta: quantity,
            reason: `Transfer from ${sourceStore.name}: ${reason}`,
            reference: transfer.id,
          },
        ],
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "inventory.transferred",
          entityType: "StockTransfer",
          entityId: transfer.id,
          details: {
            productName: variant.product.name,
            sku: variant.sku,
            fromStoreId: sourceStore.id,
            fromStoreName: sourceStore.name,
            toStoreId: targetStore.id,
            toStoreName: targetStore.name,
            quantity,
            reason,
          },
        },
      });
    }, { maxWait: 10_000, timeout: 30_000 });

    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { status: "success", message: `${quantity} unit${quantity === 1 ? "" : "s"} transferred successfully.` };
  } catch (error) {
    if (error instanceof Error && error.message === "TRANSFER_STORE_NOT_AVAILABLE") {
      return { status: "error", message: "Choose an active destination store in your business." };
    }
    if (error instanceof Error && error.message === "TRANSFER_VARIANT_NOT_AVAILABLE") {
      return { status: "error", message: "That product variant is no longer active. Refresh and try again." };
    }
    if (error instanceof Error && error.message === "TRANSFER_SOURCE_STOCK_MISSING") {
      return { status: "error", message: "No stock record exists for that variant in the active store." };
    }
    if (error instanceof Error && error.message === "TRANSFER_INSUFFICIENT_STOCK") {
      return { status: "error", message: "There is not enough available stock to complete this transfer." };
    }
    console.error("Inventory transfer failed.", error);
    return { status: "error", message: "The stock transfer could not be completed. Please try again." };
  }
}
