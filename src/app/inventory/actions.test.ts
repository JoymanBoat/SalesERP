import { beforeEach, describe, expect, it, vi } from "vitest";

const { auditCreate, findLevel, findStore, findVariant, getWorkspace, inventoryUpsert, movementCreate, movementCreateMany, queryRaw, revalidatePath, transferCreate, transaction, updateMany } = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  findLevel: vi.fn(),
  findStore: vi.fn(),
  findVariant: vi.fn(),
  getWorkspace: vi.fn(),
  inventoryUpsert: vi.fn(),
  movementCreate: vi.fn(),
  movementCreateMany: vi.fn(),
  queryRaw: vi.fn(),
  revalidatePath: vi.fn(),
  transferCreate: vi.fn(),
  transaction: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: transaction },
}));

vi.mock("@/lib/workspace", () => ({
  getWorkspace,
  getMutationWorkspace: (_formData: FormData, options: unknown) => getWorkspace(options),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { MembershipRole } from "@prisma/client";
import {
  adjustInventory,
  reconcileInventoryCount,
  transferInventory,
  updateInventoryReorderPoint,
  writeOffDamagedStock,
} from "./actions";

const variantId = "clh1p2s3t0000qwertyuiopas";
const sourceStoreId = "clh1p2s3t0002qwertyuiopas";
const targetStoreId = "clh1p2s3t0003qwertyuiopas";
const previousState = { status: "idle" as const, message: "" };

function adjustmentForm(quantityDelta = "-2") {
  const formData = new FormData();
  formData.set("variantId", variantId);
  formData.set("quantityDelta", quantityDelta);
  formData.set("reason", "Damaged packaging");
  return formData;
}

function damagedStockForm(quantity = "2") {
  const formData = new FormData();
  formData.set("variantId", variantId);
  formData.set("quantity", quantity);
  formData.set("reason", "Broken during handling");
  return formData;
}

function inventoryCountForm(expectedQuantity = "10", countedQuantity = "12") {
  const formData = new FormData();
  formData.set("variantId", variantId);
  formData.set("expectedQuantity", expectedQuantity);
  formData.set("countedQuantity", countedQuantity);
  formData.set("reason", "Weekly shelf count");
  return formData;
}

function reorderPointForm(expectedReorderPoint = "5", reorderPoint = "8") {
  const formData = new FormData();
  formData.set("variantId", variantId);
  formData.set("expectedReorderPoint", expectedReorderPoint);
  formData.set("reorderPoint", reorderPoint);
  return formData;
}

function transferForm(toStoreId = targetStoreId, quantity = "4") {
  const formData = new FormData();
  formData.set("variantId", variantId);
  formData.set("toStoreId", toStoreId);
  formData.set("quantity", quantity);
  formData.set("reason", "Balance branch stock");
  return formData;
}

function setupInventoryTransaction() {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue({
    organization: { id: "org-1", allowNegativeStock: false },
    membership: { role: MembershipRole.INVENTORY_MANAGER, userId: "user-1" },
    store: { id: "store-1", name: "Accra Central" },
  });
  findLevel.mockResolvedValue({
    id: "level-1",
    quantity: 10,
    reserved: 3,
    reorderPoint: 5,
    variant: { sku: "SKU-1", product: { name: "Product One", archivedAt: null } },
  });
  updateMany.mockResolvedValue({ count: 1 });
  movementCreate.mockResolvedValue({});
  findStore.mockResolvedValue({ id: "store-2", name: "Osu" });
  findVariant.mockResolvedValue({
    id: variantId,
    sku: "SKU-1",
    product: { name: "Product One" },
  });
  transferCreate.mockResolvedValue({ id: "transfer-1" });
  inventoryUpsert.mockResolvedValue({});
  movementCreateMany.mockResolvedValue({ count: 2 });
  queryRaw.mockResolvedValue([]);
  auditCreate.mockResolvedValue({});
  transaction.mockImplementation(async (callback) => callback({
    $queryRaw: queryRaw,
    store: { findFirst: findStore },
    productVariant: { findFirst: findVariant },
    stockTransfer: { create: transferCreate },
    inventoryLevel: { findFirst: findLevel, updateMany, upsert: inventoryUpsert },
    inventoryMovement: { create: movementCreate, createMany: movementCreateMany },
    auditLog: { create: auditCreate },
  }));
}

describe("adjustInventory", () => {
  beforeEach(setupInventoryTransaction);

  it("applies a tenant/store-scoped adjustment with a reserved-stock guard and audit trail", async () => {
    const result = await adjustInventory(previousState, adjustmentForm());

    expect(result).toEqual({ status: "success", message: "Stock adjustment recorded." });
    expect(findLevel).toHaveBeenCalledWith({
      where: { organizationId: "org-1", storeId: "store-1", variantId },
      include: { variant: { include: { product: true } } },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "level-1", quantity: { gte: 5 } },
      data: { quantity: { increment: -2 } },
    });
    expect(movementCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        storeId: "store-1",
        variantId,
        createdById: "user-1",
        type: "ADJUSTMENT",
        quantityDelta: -2,
        reason: "Damaged packaging",
      },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        actorId: "user-1",
        action: "inventory.adjusted",
        entityType: "InventoryLevel",
        entityId: "level-1",
        details: {
          productName: "Product One",
          sku: "SKU-1",
          quantityDelta: -2,
          reason: "Damaged packaging",
          resultingQuantity: 8,
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/inventory");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects a decrement that would consume reserved stock before writing", async () => {
    const result = await adjustInventory(previousState, adjustmentForm("-8"));

    expect(result).toEqual({
      status: "error",
      message: "This adjustment would make available stock negative.",
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(movementCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a concurrent stock change if the guarded update no longer matches", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    const result = await adjustInventory(previousState, adjustmentForm("-2"));

    expect(result.status).toBe("error");
    expect(result.message).toContain("available stock negative");
    expect(movementCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("rejects archived or missing stock and denies invalid roles before a transaction", async () => {
    findLevel.mockResolvedValueOnce(null);
    const missing = await adjustInventory(previousState, adjustmentForm());
    expect(missing.message).toContain("not available in your active store");

    findLevel.mockResolvedValueOnce({
      id: "level-1",
      quantity: 10,
      reserved: 0,
      variant: { sku: "SKU-1", product: { name: "Archived", archivedAt: new Date() } },
    });
    const archived = await adjustInventory(previousState, adjustmentForm());
    expect(archived.message).toContain("Archived products cannot be adjusted");

    const previousTransactionCalls = transaction.mock.calls.length;
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1", allowNegativeStock: false },
      membership: { role: MembershipRole.CASHIER, userId: "user-1" },
      store: { id: "store-1" },
    });
    const denied = await adjustInventory(previousState, adjustmentForm());

    expect(denied).toEqual({ status: "error", message: "Your role cannot adjust stock." });
    expect(transaction).toHaveBeenCalledTimes(previousTransactionCalls);
  });

  it("rejects invalid adjustment input before workspace or database access", async () => {
    const result = await adjustInventory(previousState, new FormData());

    expect(result.status).toBe("error");
    expect(getWorkspace).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("writeOffDamagedStock", () => {
  beforeEach(setupInventoryTransaction);

  it("writes off only available units and records a damage movement and audit event", async () => {
    const result = await writeOffDamagedStock(previousState, damagedStockForm());

    expect(result).toEqual({ status: "success", message: "2 damaged units written off." });
    expect(findLevel).toHaveBeenCalledWith({
      where: { organizationId: "org-1", storeId: "store-1", variantId },
      include: { variant: { include: { product: true } } },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "level-1",
        organizationId: "org-1",
        storeId: "store-1",
        quantity: { gte: 5 },
        reserved: 3,
      },
      data: { quantity: { decrement: 2 } },
    });
    expect(movementCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        storeId: "store-1",
        variantId,
        createdById: "user-1",
        type: "DAMAGE",
        quantityDelta: -2,
        reason: "Damaged stock: Broken during handling",
        reference: "level-1",
      },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "inventory.damaged_stock_written_off",
        details: expect.objectContaining({
          productName: "Product One",
          sku: "SKU-1",
          quantity: 2,
          resultingQuantity: 8,
        }),
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/inventory");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects reserved-stock overdraw and invalid inputs without downstream writes", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    const unavailable = await writeOffDamagedStock(previousState, damagedStockForm("8"));

    expect(unavailable).toEqual({
      status: "error",
      message: "The write-off cannot reduce stock below the quantity reserved for orders.",
    });
    expect(movementCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const invalid = await writeOffDamagedStock(previousState, damagedStockForm("0"));
    expect(invalid.status).toBe("error");
    expect(getWorkspace).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("reconcileInventoryCount", () => {
  beforeEach(setupInventoryTransaction);

  it("reconciles an observed count with a guarded quantity update and audit trail", async () => {
    const result = await reconcileInventoryCount(previousState, inventoryCountForm("10", "12"));

    expect(result).toEqual({
      status: "success",
      message: "Count reconciled with a +2 unit adjustment.",
    });
    expect(findLevel).toHaveBeenCalledWith({
      where: { organizationId: "org-1", storeId: "store-1", variantId },
      include: { variant: { include: { product: true } } },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "level-1",
        organizationId: "org-1",
        storeId: "store-1",
        quantity: 10,
        reserved: { lte: 12 },
      },
      data: { quantity: 12 },
    });
    expect(movementCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        storeId: "store-1",
        variantId,
        createdById: "user-1",
        type: "ADJUSTMENT",
        quantityDelta: 2,
        reason: "Cycle count: Weekly shelf count",
        reference: "level-1",
      },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "inventory.count_reconciled",
        details: {
          productName: "Product One",
          sku: "SKU-1",
          expectedQuantity: 10,
          countedQuantity: 12,
          quantityDelta: 2,
          reason: "Weekly shelf count",
        },
      }),
    });
  });

});

describe("updateInventoryReorderPoint", () => {
    beforeEach(setupInventoryTransaction);

    it("updates the selected store threshold with optimistic concurrency and audit history", async () => {
      const result = await updateInventoryReorderPoint(previousState, reorderPointForm());

      expect(result).toEqual({ status: "success", message: "Reorder point updated." });
      expect(findLevel).toHaveBeenCalledWith({
        where: { organizationId: "org-1", storeId: "store-1", variantId },
        include: { variant: { include: { product: true } } },
      });
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: "level-1",
          organizationId: "org-1",
          storeId: "store-1",
          reorderPoint: 5,
        },
        data: { reorderPoint: 8 },
      });
      expect(auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "inventory.reorder_point_updated",
          entityId: "level-1",
          details: expect.objectContaining({
            productName: "Product One",
            sku: "SKU-1",
            storeId: "store-1",
            previousReorderPoint: 5,
            reorderPoint: 8,
          }),
        }),
      });
    });

    it("rejects stale thresholds and archived products without auditing", async () => {
      updateMany.mockResolvedValue({ count: 0 });

      const stale = await updateInventoryReorderPoint(previousState, reorderPointForm());

      expect(stale.message).toContain("reorder point changed elsewhere");
      expect(auditCreate).not.toHaveBeenCalled();

      findLevel.mockResolvedValueOnce({
        id: "level-1",
        quantity: 10,
        reserved: 3,
        reorderPoint: 5,
        variant: { sku: "SKU-1", product: { name: "Archived", archivedAt: new Date() } },
      });
      const unavailable = await updateInventoryReorderPoint(previousState, reorderPointForm());

      expect(unavailable.message).toContain("unavailable in your active store");
      expect(auditCreate).not.toHaveBeenCalled();
    });
  });

  describe("transferInventory", () => {
    beforeEach(() => {
      setupInventoryTransaction();
      getWorkspace.mockResolvedValue({
        organization: { id: "org-1", allowNegativeStock: false },
        membership: { role: MembershipRole.INVENTORY_MANAGER, userId: "user-1" },
        store: { id: sourceStoreId, name: "Accra Central" },
      });
      findStore.mockResolvedValue({ id: targetStoreId, name: "Osu" });
    });

    it("transfers available stock atomically with paired movements and an audit event", async () => {
      const result = await transferInventory(previousState, transferForm());

      expect(result).toEqual({ status: "success", message: "4 units transferred successfully." });
      expect(findStore).toHaveBeenCalledWith({
        where: { id: targetStoreId, organizationId: "org-1", active: true },
        select: { id: true, name: true },
      });
      expect(findVariant).toHaveBeenCalledWith({
        where: { id: variantId, organizationId: "org-1", product: { archivedAt: null } },
        select: { id: true, sku: true, product: { select: { name: true } } },
      });
      expect(queryRaw).toHaveBeenCalledOnce();
      expect(findLevel).toHaveBeenCalledWith({
        where: { organizationId: "org-1", storeId: sourceStoreId, variantId },
      });
      expect(transferCreate).toHaveBeenCalledWith({
        data: {
          organizationId: "org-1",
          fromStoreId: sourceStoreId,
          toStoreId: targetStoreId,
          variantId,
          createdById: "user-1",
          quantity: 4,
          reason: "Balance branch stock",
        },
      });
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: "level-1",
          organizationId: "org-1",
          storeId: sourceStoreId,
          quantity: { gte: 7 },
          reserved: 3,
        },
        data: { quantity: { decrement: 4 } },
      });
      expect(inventoryUpsert).toHaveBeenCalledWith({
        where: { storeId_variantId: { storeId: targetStoreId, variantId } },
        create: { organizationId: "org-1", storeId: targetStoreId, variantId, quantity: 4 },
        update: { quantity: { increment: 4 } },
      });
      expect(movementCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            organizationId: "org-1",
            storeId: sourceStoreId,
            variantId,
            type: "TRANSFER_OUT",
            quantityDelta: -4,
            reason: "Transfer to Osu: Balance branch stock",
            reference: "transfer-1",
          }),
          expect.objectContaining({
            organizationId: "org-1",
            storeId: targetStoreId,
            variantId,
            type: "TRANSFER_IN",
            quantityDelta: 4,
            reason: "Transfer from Accra Central: Balance branch stock",
            reference: "transfer-1",
          }),
        ],
      });
      expect(auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "inventory.transferred",
          entityType: "StockTransfer",
          entityId: "transfer-1",
          details: expect.objectContaining({
            fromStoreId: sourceStoreId,
            toStoreId: targetStoreId,
            quantity: 4,
            reason: "Balance branch stock",
          }),
        }),
      });
    });

    it("rejects transfers that exceed available stock and source-equals-destination requests", async () => {
      findLevel.mockResolvedValueOnce({
        id: "level-1",
        quantity: 6,
        reserved: 3,
        variant: { sku: "SKU-1", product: { name: "Product One", archivedAt: null } },
      });
      const unavailable = await transferInventory(previousState, transferForm(targetStoreId, "4"));

      expect(unavailable.message).toContain("not enough available stock");
      expect(transferCreate).not.toHaveBeenCalled();
      expect(inventoryUpsert).not.toHaveBeenCalled();
      expect(movementCreateMany).not.toHaveBeenCalled();

      const previousTransactionCalls = transaction.mock.calls.length;
      const sameStore = await transferInventory(previousState, transferForm(sourceStoreId, "1"));

      expect(sameStore.message).toContain("different from the active source store");
      expect(transaction).toHaveBeenCalledTimes(previousTransactionCalls);
    });
  });

describe("reconcileInventoryCount edge cases", () => {
  beforeEach(setupInventoryTransaction);

  it("rejects stale counts and counts below reservations without writes", async () => {
    findLevel.mockReset();
    findLevel.mockResolvedValue({
      id: "level-1",
      quantity: 11,
      reserved: 3,
      variant: { sku: "SKU-1", product: { name: "Product One", archivedAt: null } },
    });
    const stale = await reconcileInventoryCount(previousState, inventoryCountForm("10", "12"));

    expect(stale.message).toContain("Stock changed after this count was opened");
    expect(updateMany).not.toHaveBeenCalled();

    findLevel.mockResolvedValueOnce({
      id: "level-1",
      quantity: 10,
      reserved: 5,
      variant: { sku: "SKU-1", product: { name: "Product One", archivedAt: null } },
    });
    const belowReserved = await reconcileInventoryCount(previousState, inventoryCountForm("10", "4"));

    expect(belowReserved.message).toContain("below the quantity reserved");
    expect(updateMany).not.toHaveBeenCalled();
    expect(movementCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not create movement or audit rows when a count matches current stock", async () => {
    const result = await reconcileInventoryCount(previousState, inventoryCountForm("10", "10"));

    expect(result).toEqual({
      status: "success",
      message: "Count matches the current stock; no adjustment was needed.",
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(movementCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/inventory");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });
});
