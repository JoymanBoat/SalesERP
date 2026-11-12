import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  auditCreate,
  findInventoryLevel,
  findOrder,
  findReservations,
  findShift,
  findVariants,
  findGiftCard,
  giftCardUpdateMany,
  giftCardTransactionCreate,
  getWorkspace,
  inventoryUpdateMany,
  movementCreate,
  orderUpdate,
  paymentCreate,
  paymentUpdateMany,
  queryRaw,
  refundAggregate,
  refundCreate,
  refundFindUnique,
  refundUpdate,
  revalidatePath,
  reservationDeleteMany,
  saleReturnCreate,
  saleReturnItemFindMany,
  transaction,
  inventoryUpdate,
  taxRateFindMany,
  taxRateUpsert,
  orderAggregate,
  orderCreate,
} = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  findInventoryLevel: vi.fn(),
  findOrder: vi.fn(),
  findReservations: vi.fn(),
  findShift: vi.fn(),
  findVariants: vi.fn(),
  findGiftCard: vi.fn(),
  giftCardUpdateMany: vi.fn(),
  giftCardTransactionCreate: vi.fn(),
  getWorkspace: vi.fn(),
  inventoryUpdateMany: vi.fn(),
  movementCreate: vi.fn(),
  orderUpdate: vi.fn(),
  paymentCreate: vi.fn(),
  paymentUpdateMany: vi.fn(),
  queryRaw: vi.fn(),
  refundAggregate: vi.fn(),
  refundCreate: vi.fn(),
  refundFindUnique: vi.fn(),
  refundUpdate: vi.fn(),
  revalidatePath: vi.fn(),
  reservationDeleteMany: vi.fn(),
  saleReturnCreate: vi.fn(),
  saleReturnItemFindMany: vi.fn(),
  transaction: vi.fn(),
  inventoryUpdate: vi.fn(),
  taxRateFindMany: vi.fn(),
  taxRateUpsert: vi.fn(),
  orderAggregate: vi.fn(),
  orderCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: transaction },
}));

vi.mock("@/lib/workspace", () => ({
  getWorkspace,
  getMutationWorkspace: (_formData: FormData, options: unknown) => getWorkspace(options),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { MembershipRole, OrderStatus, Prisma } from "@prisma/client";
import { checkoutCash, refundSale, returnSaleItems, saveSaleDraft, updateTaxSettings, voidSale } from "./actions";

const orderId = "clh1p2s3t0000qwertyuiopas";
const variantId = "clh1p2s3t0001qwertyuiopas";
const itemId = "clh1p2s3t0004qwertyuiopas";
const previousState = { status: "idle" as const, message: "" };

function checkoutForm(cashReceived = "30.00") {
  const formData = new FormData();
  formData.set("orderId", orderId);
  formData.set("cashReceived", cashReceived);
  return formData;
}

function saveDraftForm(orderUpdatedAt: string) {
  const formData = new FormData();
  formData.set("orderId", orderId);
  formData.set("expectedUpdatedAt", orderUpdatedAt);
  formData.set("lines", JSON.stringify([{ variantId, quantity: 3 }]));
  return formData;
}

function returnForm(quantity = 1, restock = true) {
  const formData = new FormData();
  formData.set("orderId", orderId);
  formData.set("reason", "Customer return");
  formData.set("idempotencyKey", "e8cc9826-94b6-4d4d-b513-8e44e2734f03");
  formData.set("lines", JSON.stringify([{ itemId, quantity, restock }]));
  return formData;
}

function voidForm(reason = "Customer changed mind") {
  const formData = new FormData();
  formData.set("orderId", orderId);
  formData.set("reason", reason);
  return formData;
}

function refundForm(amount = "10.00") {
  const formData = new FormData();
  formData.set("orderId", orderId);
  formData.set("amount", amount);
  formData.set("reason", "Customer request");
  formData.set("idempotencyKey", "e8cc9826-94b6-4d4d-b513-8e44e2734f03");
  return formData;
}

function setupCheckout() {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue({
    organization: {
      id: "org-1",
      allowNegativeStock: false,
      currency: "GHS",
      timezone: "Africa/Accra",
      taxRate: new Prisma.Decimal("0"),
    },
    membership: { role: MembershipRole.CASHIER, userId: "user-1" },
    store: { id: "store-1" },
    register: { id: "register-1" },
  });
  findOrder.mockResolvedValue({
    id: orderId,
    number: "SALE-001",
    total: new Prisma.Decimal("25.00"),
    giftCardRedeemed: new Prisma.Decimal("0.00"),
    giftCardId: null,
    customerId: null,
    loyaltyPointsRedeemed: 0n,
    registerShiftId: "shift-1",
    promotionId: null,
    promotionCode: null,
    items: [{
      variantId,
      quantity: 2,
      productName: "Tea",
      unitPrice: new Prisma.Decimal("12.50"),
      variant: { trackInventory: true, productId: "product-1" },
    }],
  });
  findShift.mockResolvedValue({ id: "shift-1" });
  findGiftCard.mockResolvedValue({
    id: "gift-card-1",
    balance: new Prisma.Decimal("20.00"),
    active: true,
    expiresAt: null,
  });
  giftCardUpdateMany.mockResolvedValue({ count: 1 });
  giftCardTransactionCreate.mockResolvedValue({});
  findVariants.mockResolvedValue([{
    id: variantId,
    name: "Standard",
    sku: "TEA-001",
    unitPrice: new Prisma.Decimal("12.50"),
    trackInventory: true,
    productId: "product-1",
    product: { name: "Tea", taxTreatment: "STANDARD" },
  }]);
  findReservations.mockResolvedValue([{ variantId, quantity: 2 }]);
  findInventoryLevel.mockResolvedValue({ id: "level-1", quantity: 10, reserved: 2 });
  inventoryUpdateMany.mockResolvedValue({ count: 1 });
  movementCreate.mockResolvedValue({});
  reservationDeleteMany.mockResolvedValue({ count: 1 });
  paymentCreate.mockResolvedValue({ id: "payment-1" });
  paymentUpdateMany.mockResolvedValue({ count: 1 });
  refundFindUnique.mockResolvedValue(null);
  refundAggregate.mockResolvedValue({ _sum: { amount: null } });
  refundCreate.mockResolvedValue({ id: "refund-1" });
  refundUpdate.mockResolvedValue({});
  saleReturnCreate.mockResolvedValue({ id: "return-1" });
  saleReturnItemFindMany.mockResolvedValue([]);
  inventoryUpdate.mockResolvedValue({});
  orderUpdate.mockResolvedValue({});
  taxRateFindMany.mockResolvedValue([]);
  taxRateUpsert.mockResolvedValue({});
  orderAggregate.mockResolvedValue({ _max: { number: 6 } });
  orderCreate.mockResolvedValue({ id: orderId, number: 7, updatedAt: new Date("2026-11-06T00:00:00.000Z") });
  auditCreate.mockResolvedValue({});
  queryRaw.mockResolvedValue([]);

  transaction.mockImplementation(async (callback) => callback({
    $queryRaw: queryRaw,
    order: { findFirst: findOrder, update: orderUpdate, aggregate: orderAggregate, create: orderCreate },
    taxRateSetting: { findMany: taxRateFindMany, upsert: taxRateUpsert },
    productVariant: { findMany: findVariants },
    registerShift: { findFirst: findShift },
    inventoryReservation: { findMany: findReservations, deleteMany: reservationDeleteMany },
    inventoryLevel: { findFirst: findInventoryLevel, updateMany: inventoryUpdateMany, update: inventoryUpdate },
    inventoryMovement: { create: movementCreate },
    refund: {
      findUnique: refundFindUnique,
      aggregate: refundAggregate,
      create: refundCreate,
      update: refundUpdate,
    },
    saleReturnItem: { findMany: saleReturnItemFindMany },
    saleReturn: { create: saleReturnCreate },
    payment: { create: paymentCreate, updateMany: paymentUpdateMany },
    giftCard: { findFirst: findGiftCard, updateMany: giftCardUpdateMany },
    giftCardTransaction: { create: giftCardTransactionCreate },
    auditLog: { create: auditCreate },
  }));
}

describe("checkoutCash", () => {
  beforeEach(setupCheckout);

  it("debits a gift card and settles the remaining amount as cash", async () => {
    findOrder.mockResolvedValue({
      id: orderId,
      number: "SALE-001",
      total: new Prisma.Decimal("25.00"),
      giftCardRedeemed: new Prisma.Decimal("10.00"),
      giftCardId: "gift-card-1",
      customerId: null,
      loyaltyPointsRedeemed: 0n,
      registerShiftId: "shift-1",
      promotionId: null,
      promotionCode: null,
      items: [{
        variantId,
        quantity: 2,
        productName: "Tea",
        unitPrice: new Prisma.Decimal("12.50"),
        variant: { trackInventory: true, productId: "product-1" },
      }],
    });

    const result = await checkoutCash(previousState, checkoutForm("20.00"));

    expect(result).toEqual({
      status: "success",
      message: "Sale completed. Change due: GHS 5.00.",
      orderId,
      receiptHref: `/pos/receipt/${orderId}`,
    });
    expect(findGiftCard).toHaveBeenCalledWith({
      where: { id: "gift-card-1", organizationId: "org-1" },
      select: { id: true, balance: true, active: true, expiresAt: true },
    });
    expect(giftCardUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "gift-card-1",
        organizationId: "org-1",
        active: true,
        balance: { gte: new Prisma.Decimal("10.00") },
      },
      data: { balance: { decrement: new Prisma.Decimal("10.00") } },
    });
    expect(giftCardTransactionCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        giftCardId: "gift-card-1",
        orderId,
        type: "REDEEM",
        amountDelta: new Prisma.Decimal("-10.00"),
        createdById: "user-1",
      },
    });
    expect(paymentCreate).toHaveBeenCalledTimes(2);
    expect(paymentCreate.mock.calls.map(([call]) => ({
      method: call.data.method,
      amount: call.data.amount.toString(),
    }))).toEqual([
      { method: "GIFT_CARD", amount: "10" },
      { method: "CASH", amount: "15" },
    ]);
  });

  it("completes a tenant-scoped cash sale and records inventory, payment, and audit changes", async () => {
    const result = await checkoutCash(previousState, checkoutForm());

    expect(result).toEqual({
      status: "success",
      message: "Sale completed. Change due: GHS 5.00.",
      orderId,
      receiptHref: `/pos/receipt/${orderId}`,
    });
    expect(findOrder).toHaveBeenCalledWith({
      where: {
        id: orderId,
        organizationId: "org-1",
        storeId: "store-1",
        status: OrderStatus.DRAFT,
        registerShift: { is: { registerId: "register-1" } },
      },
      include: { items: { include: { variant: { select: { trackInventory: true, productId: true } } } } },
    });
    expect(inventoryUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "level-1",
        organizationId: "org-1",
        storeId: "store-1",
        quantity: { gte: 2 },
        reserved: 2,
      },
      data: { quantity: { decrement: 2 }, reserved: { decrement: 2 } },
    });
    expect(movementCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        storeId: "store-1",
        variantId,
        createdById: "user-1",
        type: "SALE",
        quantityDelta: -2,
        reason: "POS sale #SALE-001",
        reference: orderId,
      },
    });
    expect(paymentCreate).toHaveBeenCalledOnce();
    const payment = paymentCreate.mock.calls[0][0].data;
    expect(payment.amount.toString()).toBe("25");
    expect(payment.cashReceived.toString()).toBe("30");
    expect(payment.changeGiven.toString()).toBe("5");
    expect(payment.idempotencyKey).toBe(`cash-order:${orderId}`);
    expect(reservationDeleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", storeId: "store-1", orderId },
    });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: OrderStatus.PAID, loyaltyPointsEarned: 0n },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        actorId: "user-1",
        action: "pos.sale_completed",
        entityId: orderId,
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/pos");
    expect(revalidatePath).toHaveBeenCalledWith("/inventory");
  });

  it("does not settle a held cart after its register shift has closed", async () => {
    findShift.mockResolvedValue(null);

    const result = await checkoutCash(previousState, checkoutForm("25.00"));

    expect(result).toEqual({
      status: "error",
      message: "The register shift for this cart is closed.",
    });
    expect(inventoryUpdateMany).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects checkout when the guarded inventory decrement fails", async () => {
    inventoryUpdateMany.mockResolvedValue({ count: 0 });

    const result = await checkoutCash(previousState, checkoutForm("25.00"));

    expect(result).toEqual({
      status: "error",
      message: "Not enough available stock for Tea.",
    });
    expect(movementCreate).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("denies checkout to roles without register access before opening a transaction", async () => {
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.INVENTORY_MANAGER, userId: "user-1" },
      store: { id: "store-1" },
      register: { id: "register-1" },
    });

    const result = await checkoutCash(previousState, checkoutForm());

    expect(result).toEqual({
      status: "error",
      message: "Your role cannot check out sales.",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("saveSaleDraft", () => {
  beforeEach(setupCheckout);

  it("preserves local edits and stops before changing reservations when the held cart version is stale", async () => {
    queryRaw.mockResolvedValue([{ id: "shift-1" }]);
    findOrder.mockResolvedValue({
      id: orderId,
      updatedAt: new Date("2026-11-06T00:00:00.000Z"),
      giftCardId: null,
    });

    const result = await saveSaleDraft(
      previousState,
      saveDraftForm("2026-11-05T23:59:00.000Z"),
    );

    expect(result).toEqual({
      status: "error",
      message: "This held cart changed on the server. Your local cart remains saved; discard local changes and reload before continuing.",
      conflict: true,
    });
    expect(findOrder).toHaveBeenCalledWith({
      where: {
        id: orderId,
        organizationId: "org-1",
        storeId: "store-1",
        status: OrderStatus.DRAFT,
        registerShiftId: "shift-1",
      },
      include: { items: { select: { variantId: true, quantity: true } } },
    });
    expect(findVariants).toHaveBeenCalledOnce();
    expect(findReservations).not.toHaveBeenCalled();
    expect(inventoryUpdateMany).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("saveSaleDraft tax snapshots", () => {
  beforeEach(() => {
    setupCheckout();
    queryRaw.mockResolvedValue([{ id: "shift-1" }]);
    findReservations.mockResolvedValue([]);
    findVariants.mockResolvedValue([
      { id: variantId, name: "Standard", sku: "TEA-001", unitPrice: new Prisma.Decimal("100.00"), trackInventory: false, productId: "product-1", product: { name: "Tea", taxTreatment: "STANDARD" } },
      { id: "clh1p2s3t0002qwertyuiopas", name: "Default", sku: "BK-001", unitPrice: new Prisma.Decimal("50.00"), trackInventory: false, productId: "product-2", product: { name: "Book", taxTreatment: "EXEMPT" } },
    ]);
  });

  function newDraftForm() {
    const formData = new FormData();
    formData.set("lines", JSON.stringify([{ variantId, quantity: 1 }, { variantId: "clh1p2s3t0002qwertyuiopas", quantity: 1 }]));
    return formData;
  }

  it("keeps zero tax when no rates are configured", async () => {
    const result = await saveSaleDraft(previousState, newDraftForm());

    expect(result.status).toBe("success");
    const data = orderCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ taxTotal: "0.00", taxRate: "0.00", vatTotal: "0.00", nhilTotal: "0.00", getfundTotal: "0.00", taxComponentsRecorded: true });
  });

  it("snapshots component rates, totals, and item treatments from the rates effective today", async () => {
    taxRateFindMany.mockResolvedValue([
      { component: "VAT", rate: new Prisma.Decimal("15"), effectiveFrom: new Date("2000-01-01T00:00:00.000Z") },
      { component: "VAT", rate: new Prisma.Decimal("99"), effectiveFrom: new Date("2999-01-01T00:00:00.000Z") },
      { component: "NHIL", rate: new Prisma.Decimal("2.5"), effectiveFrom: new Date("2000-01-01T00:00:00.000Z") },
      { component: "GETFUND", rate: new Prisma.Decimal("2.5"), effectiveFrom: new Date("2000-01-01T00:00:00.000Z") },
    ]);

    await saveSaleDraft(previousState, newDraftForm());

    const data = orderCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      vatRate: "15.00", nhilRate: "2.50", getfundRate: "2.50", taxRate: "20.00",
      vatTotal: "15.00", nhilTotal: "2.50", getfundTotal: "2.50", taxTotal: "20.00", total: "170.00",
    });
    expect(data.items.create.map((item: { taxTreatment: string; taxAmount: string }) => [item.taxTreatment, item.taxAmount])).toEqual([
      ["STANDARD", "20.00"],
      ["EXEMPT", "0.00"],
    ]);
  });
});

describe("updateTaxSettings", () => {
  function taxForm(values: Record<string, string> = {}) {
    const formData = new FormData();
    for (const [key, value] of Object.entries({ vat: "15", nhil: "2.5", getfund: "2.5", effectiveFrom: "2026-11-06", ...values })) {
      formData.set(key, value);
    }
    return formData;
  }

  beforeEach(setupCheckout);

  it("blocks roles that cannot manage pricing", async () => {
    const result = await updateTaxSettings(previousState, taxForm());
    expect(result.status).toBe("error");
    expect(taxRateUpsert).not.toHaveBeenCalled();
  });

  it("saves dated history rows per component and audits the change for managers", async () => {
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.MANAGER, userId: "user-1" },
    });

    const result = await updateTaxSettings(previousState, taxForm());

    expect(result.status).toBe("success");
    expect(taxRateUpsert).toHaveBeenCalledTimes(3);
    expect(taxRateUpsert.mock.calls.map(([args]) => [args.create.component, args.create.rate.toString()])).toEqual([
      ["VAT", "15"], ["NHIL", "2.5"], ["GETFUND", "2.5"],
    ]);
    expect(taxRateUpsert.mock.calls[0][0].create.effectiveFrom).toEqual(new Date("2026-11-06T00:00:00.000Z"));
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "organization.tax_settings_updated" }) });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/pos");
  });

  it("rejects invalid rates before writing", async () => {
    getWorkspace.mockResolvedValue({ organization: { id: "org-1" }, membership: { role: MembershipRole.OWNER, userId: "user-1" } });
    const result = await updateTaxSettings(previousState, taxForm({ vat: "101" }));
    expect(result.status).toBe("error");
    expect(taxRateUpsert).not.toHaveBeenCalled();
  });
});

describe("voidSale", () => {
  beforeEach(setupCheckout);

  it("voids a held cart and releases its tenant/store-scoped reservation", async () => {
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.MANAGER, userId: "manager-1" },
      store: { id: "store-1" },
      register: { id: "register-1" },
    });
    findOrder.mockResolvedValue({ id: orderId, number: "SALE-001" });

    const result = await voidSale(previousState, voidForm());

    expect(result).toEqual({ status: "success", message: "Held sale voided." });
    expect(findOrder).toHaveBeenCalledWith({
      where: {
        id: orderId,
        organizationId: "org-1",
        storeId: "store-1",
        status: OrderStatus.DRAFT,
        registerShift: { is: { registerId: "register-1" } },
      },
      select: { id: true, number: true },
    });
    expect(findReservations).toHaveBeenCalledWith({
      where: { organizationId: "org-1", storeId: "store-1", orderId },
      orderBy: { variantId: "asc" },
      select: { variantId: true, quantity: true },
    });
    expect(inventoryUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "level-1",
        organizationId: "org-1",
        storeId: "store-1",
        reserved: { gte: 2 },
      },
      data: { reserved: { decrement: 2 } },
    });
    expect(reservationDeleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", storeId: "store-1", orderId },
    });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        actorId: "manager-1",
        action: "pos.sale_voided",
        entityType: "Order",
        entityId: orderId,
        details: { number: "SALE-001", reason: "Customer changed mind" },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/pos");
    expect(revalidatePath).toHaveBeenCalledWith("/pos/transactions");
  });

  it("keeps the held cart when its reservation cannot be safely released", async () => {
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.MANAGER, userId: "manager-1" },
      store: { id: "store-1" },
      register: { id: "register-1" },
    });
    findOrder.mockResolvedValue({ id: orderId, number: "SALE-001" });
    inventoryUpdateMany.mockResolvedValue({ count: 0 });

    const result = await voidSale(previousState, voidForm());

    expect(result).toEqual({
      status: "error",
      message: "Stock reservation data is inconsistent. Contact an administrator before voiding this cart.",
    });
    expect(reservationDeleteMany).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("denies held-sale voids to roles without pricing-management access", async () => {
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.CASHIER, userId: "cashier-1" },
      store: { id: "store-1" },
      register: { id: "register-1" },
    });

    const result = await voidSale(previousState, voidForm());

    expect(result).toEqual({
      status: "error",
      message: "Only an owner or manager can void a held sale.",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("refundSale", () => {
  beforeEach(() => {
    setupCheckout();
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.MANAGER, userId: "manager-1" },
      store: { id: "store-1" },
      register: { id: "register-1" },
    });
    findOrder.mockResolvedValue({
      id: orderId,
      number: "SALE-001",
      total: new Prisma.Decimal("25.00"),
      giftCardId: null,
      giftCardRedeemed: new Prisma.Decimal("0.00"),
      customerId: null,
      loyaltyPointsEarned: 0n,
      loyaltyPointsRedeemed: 0n,
    });
    queryRaw.mockResolvedValue([{ id: "shift-1" }]);
  });

  it("records a scoped cash refund, updates settlement status, and audits the refund", async () => {
    const result = await refundSale(previousState, refundForm());

    expect(result).toEqual({
      status: "success",
      message: "Refund recorded. Any gift-card-funded value was restored to the original gift card.",
    });
    expect(refundFindUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: "e8cc9826-94b6-4d4d-b513-8e44e2734f03", organizationId: "org-1" },
      select: { id: true },
    });
    expect(findOrder).toHaveBeenCalledWith({
      where: {
        id: orderId,
        organizationId: "org-1",
        storeId: "store-1",
        status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED] },
      },
      include: {
        payments: {
          where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } },
        },
      },
    });
    expect(refundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        storeId: "store-1",
        orderId,
        createdById: "manager-1",
        amount: expect.any(Prisma.Decimal),
        cashRefundAmount: expect.any(Prisma.Decimal),
        reason: "Customer request",
        idempotencyKey: "e8cc9826-94b6-4d4d-b513-8e44e2734f03",
      }),
    });
    expect(refundUpdate).toHaveBeenCalledWith({
      where: { id: "refund-1" },
      data: { cashRefundAmount: new Prisma.Decimal("10.00"), registerShiftId: "shift-1" },
    });
    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: {
        orderId,
        status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] },
      },
      data: { status: "PARTIALLY_REFUNDED" },
    });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: OrderStatus.PARTIALLY_REFUNDED },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        actorId: "manager-1",
        action: "pos.refund_issued",
        entityId: orderId,
        details: expect.objectContaining({
          number: "SALE-001",
          amount: "10",
          cashRefundAmount: "10",
          giftCardRefundAmount: "0",
          reason: "Customer request",
          shiftId: "shift-1",
        }),
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/pos/transactions");
    expect(revalidatePath).toHaveBeenCalledWith(`/pos/receipt/${orderId}`);
  });

  it("rejects a refund that exceeds the remaining refundable balance", async () => {
    refundAggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal("20.00") } });

    const result = await refundSale(previousState, refundForm());

    expect(result).toEqual({
      status: "error",
      message: "Refund amount exceeds the remaining refundable balance.",
    });
    expect(refundCreate).not.toHaveBeenCalled();
    expect(refundUpdate).not.toHaveBeenCalled();
    expect(paymentUpdateMany).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("denies refunds to staff who cannot manage pricing", async () => {
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.CASHIER, userId: "cashier-1" },
      store: { id: "store-1" },
      register: { id: "register-1" },
    });

    const result = await refundSale(previousState, refundForm());

    expect(result).toEqual({
      status: "error",
      message: "Only an owner or manager can issue a refund.",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("returnSaleItems", () => {
  beforeEach(() => {
    setupCheckout();
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.MANAGER, userId: "manager-1" },
      store: { id: "store-1" },
      register: { id: "register-1" },
    });
    findOrder.mockResolvedValue({
      id: orderId,
      number: "SALE-001",
      total: new Prisma.Decimal("25.00"),
      giftCardId: null,
      giftCardRedeemed: new Prisma.Decimal("0.00"),
      customerId: null,
      loyaltyPointsEarned: 0n,
      loyaltyPointsRedeemed: 0n,
      items: [{
        id: itemId,
        variantId,
        quantity: 2,
        lineTotal: new Prisma.Decimal("25.00"),
        variant: { trackInventory: true },
      }],
    });
    queryRaw.mockResolvedValue([{ id: "shift-1" }]);
  });

  it("records and restocks a valid returned quantity with a proportional cash refund", async () => {
    const result = await returnSaleItems(previousState, returnForm());

    expect(result).toEqual({
      status: "success",
      message: "Sale return recorded. Gift-card-funded value was restored to the original card.",
    });
    expect(findOrder).toHaveBeenCalledWith({
      where: {
        id: orderId,
        organizationId: "org-1",
        storeId: "store-1",
        status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED] },
      },
      include: {
        items: {
          where: { id: { in: [itemId] } },
          include: { variant: { select: { trackInventory: true } } },
        },
      },
    });
    expect(refundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        storeId: "store-1",
        orderId,
        createdById: "manager-1",
        amount: new Prisma.Decimal("12.50"),
        cashRefundAmount: new Prisma.Decimal("12.50"),
        reason: "Customer return",
        idempotencyKey: "e8cc9826-94b6-4d4d-b513-8e44e2734f03",
      }),
    });
    expect(saleReturnCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        storeId: "store-1",
        orderId,
        refundId: "refund-1",
        createdById: "manager-1",
        reason: "Customer return",
        items: {
          create: [{
            orderItemId: itemId,
            quantity: 1,
            restocked: true,
            refunded: "12.50",
          }],
        },
      },
    });
    expect(inventoryUpdate).toHaveBeenCalledWith({
      where: { id: "level-1" },
      data: { quantity: { increment: 1 } },
    });
    expect(movementCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        storeId: "store-1",
        variantId,
        createdById: "manager-1",
        type: "RETURN",
        quantityDelta: 1,
        reason: "Customer return for sale #SALE-001: Customer return",
        reference: "return-1",
      },
    });
    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: { orderId, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } },
      data: { status: "PARTIALLY_REFUNDED" },
    });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: OrderStatus.PARTIALLY_REFUNDED },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        actorId: "manager-1",
        action: "pos.sale_return_processed",
        entityId: "return-1",
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/inventory");
  });

  it("rejects returns that exceed the remaining sold quantity before writing", async () => {
    saleReturnItemFindMany.mockResolvedValue([{ orderItemId: itemId, quantity: 2 }]);

    const result = await returnSaleItems(previousState, returnForm());

    expect(result).toEqual({
      status: "error",
      message: "Return quantity exceeds the remaining quantity on the sale.",
    });
    expect(refundCreate).not.toHaveBeenCalled();
    expect(saleReturnCreate).not.toHaveBeenCalled();
    expect(inventoryUpdate).not.toHaveBeenCalled();
    expect(movementCreate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
