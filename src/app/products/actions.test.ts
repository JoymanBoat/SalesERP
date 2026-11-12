import { beforeEach, describe, expect, it, vi } from "vitest";

const { auditCreate, categoryUpsert, categoryFind, createVariant, createVariantOptions, findOptions, findProduct, findVariants, inventoryCreate, movementCreate, productCreate, transaction, getWorkspace, revalidatePath, queryRaw } = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  categoryUpsert: vi.fn(),
  categoryFind: vi.fn(),
  createVariant: vi.fn(),
  createVariantOptions: vi.fn(),
  findOptions: vi.fn(),
  findProduct: vi.fn(),
  findVariants: vi.fn(),
  inventoryCreate: vi.fn(),
  movementCreate: vi.fn(),
  productCreate: vi.fn(),
  transaction: vi.fn(),
  getWorkspace: vi.fn(),
  revalidatePath: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    productVariant: { findMany: findVariants },
    $transaction: transaction,
  },
}));

vi.mock("@/lib/workspace", () => ({
  getWorkspace,
  getMutationWorkspace: (_formData: FormData, options: unknown) => getWorkspace(options),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { MembershipRole, Prisma } from "@prisma/client";
import { createProduct, createProductVariant, createProductVariantBatch, importProducts, updateProduct } from "./actions";

const csv = [
  "Product name,SKU,Unit price,Opening stock,Reorder point,Category,Cost price",
  "Tea,TEA-001,12.50,5,3,Beverages,7.00",
  "Mug,MUG-001,8.00,0,2,,",
].join("\r\n");

function importFormData(contents = csv, fileName = "catalog.csv") {
  const formData = new FormData();
  formData.set("file", new File([contents], fileName, { type: "text/csv" }));
  return formData;
}

describe("importProducts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.MANAGER, userId: "user-1" },
      store: { id: "store-1" },
    });
    findVariants.mockResolvedValue([]);
    categoryUpsert.mockResolvedValue({ id: "category-1" });
    let createdProducts = 0;
    productCreate.mockImplementation(async () => {
      createdProducts += 1;
      return {
        id: `product-${createdProducts}`,
        variants: [{ id: `variant-${createdProducts}` }],
      };
    });
    inventoryCreate.mockResolvedValue({});
    movementCreate.mockResolvedValue({});
    auditCreate.mockResolvedValue({});
    transaction.mockImplementation(async (callback) => callback({
      $queryRaw: queryRaw,
      category: { upsert: categoryUpsert },
      product: { create: productCreate },
      productVariant: { create: createVariant },
      productOption: { findMany: findOptions },
      productVariantOption: { createMany: createVariantOptions },
      inventoryLevel: { create: inventoryCreate },
      inventoryMovement: { create: movementCreate },
      auditLog: { create: auditCreate },
    }));
  });

  it("atomically imports validated products with opening inventory, movements, and audit events", async () => {
    const result = await importProducts({ status: "idle", message: "" }, importFormData());

    expect(result).toEqual({ status: "success", message: "2 products imported successfully." });
    expect(findVariants).toHaveBeenCalledWith({
      where: { organizationId: "org-1", sku: { in: ["TEA-001", "MUG-001"] } },
      select: { sku: true },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 30_000 });
    expect(productCreate).toHaveBeenCalledTimes(2);
    expect(productCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        name: "Tea",
        categoryId: "category-1",
      }),
    }));
    expect(inventoryCreate).toHaveBeenCalledTimes(2);
    expect(inventoryCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        storeId: "store-1",
        variantId: "variant-1",
        quantity: 5,
        reorderPoint: 3,
      },
    });
    expect(movementCreate).toHaveBeenCalledOnce();
    expect(movementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        storeId: "store-1",
        variantId: "variant-1",
        createdById: "user-1",
        quantityDelta: 5,
        reason: "Opening stock (CSV import)",
      }),
    });
    expect(auditCreate).toHaveBeenCalledTimes(2);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        actorId: "user-1",
        action: "product.imported",
        details: { sku: "TEA-001", initialStock: 5, storeId: "store-1" },
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/products");
    expect(revalidatePath).toHaveBeenCalledWith("/inventory");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects malformed or invalid files before accessing the workspace or database", async () => {
    const malformed = await importProducts(
      { status: "idle", message: "" },
      importFormData("Product name,SKU,SKU\nTea,TEA-001,TEA-002"),
    );
    const invalidExtension = await importProducts(
      { status: "idle", message: "" },
      importFormData(csv, "catalog.txt"),
    );

    expect(malformed.status).toBe("error");
    expect(malformed.message).toContain("duplicate column names");
    expect(invalidExtension).toEqual({ status: "error", message: "Choose a file with the .csv extension." });
    expect(getWorkspace).not.toHaveBeenCalled();
    expect(findVariants).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects an existing organization SKU without importing any products", async () => {
    findVariants.mockResolvedValue([{ sku: "TEA-001" }]);

    const result = await importProducts({ status: "idle", message: "" }, importFormData());

    expect(result).toEqual({
      status: "error",
      message: "SKU “TEA-001” is already in use in your business. No products were imported.",
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a duplicate SKU from the database without claiming the import succeeded", async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test", meta: { target: ["organizationId", "sku"] } },
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    transaction.mockRejectedValue(error);

    const result = await importProducts({ status: "idle", message: "" }, importFormData());

    expect(result).toEqual({
      status: "error",
      message: "A SKU is already in use in your business. No products were imported.",
    });
    expect(errorLog).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("surfaces and logs import transaction failures without invalidating pages", async () => {
    const error = new Error("database unavailable");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    transaction.mockRejectedValue(error);

    const result = await importProducts({ status: "idle", message: "" }, importFormData());

    expect(result).toEqual({ status: "error", message: "The CSV import failed. No products were imported." });
    expect(errorLog).toHaveBeenCalledWith("Product CSV import failed.", error);
    expect(revalidatePath).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("denies roles without catalog access before querying or starting a transaction", async () => {
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.CASHIER, userId: "user-1" },
      store: { id: "store-1" },
    });

    const result = await importProducts({ status: "idle", message: "" }, importFormData());

    expect(result).toEqual({ status: "error", message: "Your role cannot import products." });
    expect(findVariants).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("createProduct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.MANAGER, userId: "user-1" },
      store: { id: "store-1" },
    });
    categoryFind.mockResolvedValue({ id: "category-1" });
    productCreate.mockResolvedValue({
      id: "product-1",
      variants: [{ id: "variant-1" }],
    });
    inventoryCreate.mockResolvedValue({});
    movementCreate.mockResolvedValue({});
    auditCreate.mockResolvedValue({});
    transaction.mockImplementation(async (callback) => callback({
      category: { findUnique: categoryFind },
      product: { create: productCreate },
      inventoryLevel: { create: inventoryCreate },
      inventoryMovement: { create: movementCreate },
      auditLog: { create: auditCreate },
    }));
  });

  it("generates a SKU when one is not supplied", async () => {
    const formData = new FormData();
    formData.set("name", "Tea");
    formData.set("unitPrice", "12.50");
    formData.set("initialStock", "0");
    formData.set("reorderPoint", "3");
    expect((await createProduct({ status: "idle", message: "" }, formData)).status).toBe("success");
    expect(productCreate.mock.calls[0][0].data.variants.create.sku).toMatch(/^VAR-[A-F0-9]{32}$/);
  });

  it("atomically creates a product, variant, opening stock, movement, and audit event", async () => {
    const formData = new FormData();
    formData.set("name", "Tea");
    formData.set("sku", "TEA-001");
    formData.set("unitPrice", "12.50");
    formData.set("costPrice", "7.00");
    formData.set("initialStock", "5");
    formData.set("reorderPoint", "3");
    formData.set("category", "Beverages");
    formData.set("barcode", "0123456789012");

    const result = await createProduct({ status: "idle", message: "" }, formData);

    expect(result).toEqual({ status: "success", message: "Tea was added to your catalog." });
    expect(transaction).toHaveBeenCalledOnce();
    expect(categoryFind).toHaveBeenCalledWith({
      where: { organizationId_name: { organizationId: "org-1", name: "Beverages" } },
      select: { id: true },
    });
    expect(productCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        name: "Tea",
        categoryId: "category-1",
        taxTreatment: "STANDARD",
        variants: {
          create: {
            sku: "TEA-001",
            barcode: "0123456789012",
            unitPrice: expect.objectContaining({ s: 1 }),
            costPrice: expect.objectContaining({ s: 1 }),
          },
        },
      },
      include: { variants: true },
    });
    expect(inventoryCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        storeId: "store-1",
        variantId: "variant-1",
        quantity: 5,
        reorderPoint: 3,
      },
    });
    expect(movementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        storeId: "store-1",
        variantId: "variant-1",
        createdById: "user-1",
        quantityDelta: 5,
        reason: "Opening stock",
        reference: "product-1",
      }),
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        actorId: "user-1",
        action: "product.created",
        entityId: "product-1",
        details: { sku: "TEA-001", initialStock: 5, storeId: "store-1" },
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/products");
    expect(revalidatePath).toHaveBeenCalledWith("/inventory");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects invalid input and roles without starting a transaction", async () => {
    const invalid = await createProduct({ status: "idle", message: "" }, new FormData());
    expect(invalid.status).toBe("error");
    expect(getWorkspace).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();

    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.CASHIER, userId: "user-1" },
      store: { id: "store-1" },
    });

    const formData = new FormData();
    formData.set("name", "Tea");
    formData.set("sku", "TEA-001");
    formData.set("unitPrice", "12.50");
    formData.set("initialStock", "0");
    formData.set("reorderPoint", "0");

    const denied = await createProduct({ status: "idle", message: "" }, formData);

    expect(denied).toEqual({ status: "error", message: "Your role cannot create products." });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a category absent from the current organization", async () => {
    categoryFind.mockResolvedValue(null);
    const formData = new FormData();
    for (const [key, value] of Object.entries({ name: "Tea", sku: "TEA-001", unitPrice: "12.50", initialStock: "0", reorderPoint: "0", category: "Other organization" })) formData.set(key, value);
    const result = await createProduct({ status: "idle", message: "" }, formData);
    expect(result.status).toBe("error");
    expect(result.message).toContain("category is no longer available");
    expect(categoryFind).toHaveBeenCalledWith({ where: { organizationId_name: { organizationId: "org-1", name: "Other organization" } }, select: { id: true } });
    expect(productCreate).not.toHaveBeenCalled();
  });

  it("rejects an unavailable category when editing a product", async () => {
    categoryFind.mockResolvedValue(null);
    const formData = new FormData();
    for (const [key, value] of Object.entries({ productId: "clh1p2s3t0000qwertyuiopas", name: "Tea", sku: "TEA-001", unitPrice: "12.50", category: "Unavailable" })) formData.set(key, value);
    const result = await updateProduct({ status: "idle", message: "" }, formData);
    expect(result.status).toBe("error");
    expect(result.message).toContain("category is no longer available");
  });

  it("allows products without a category", async () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries({ name: "Tea", sku: "TEA-001", unitPrice: "12.50", initialStock: "0", reorderPoint: "0" })) formData.set(key, value);
    expect((await createProduct({ status: "idle", message: "" }, formData)).status).toBe("success");
    expect(categoryFind).not.toHaveBeenCalled();
    expect(productCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ categoryId: undefined }) }));
  });

  it("updates a product with an existing organization category", async () => {
    const productUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const variantFind = vi.fn().mockResolvedValue({ id: "variant-1" });
    const variantUpdate = vi.fn().mockResolvedValue({});
    transaction.mockImplementation(async (callback) => callback({
      category: { findUnique: categoryFind },
      product: { updateMany: productUpdate },
      productVariant: { findFirst: variantFind, update: variantUpdate },
      auditLog: { create: auditCreate },
    }));
    const formData = new FormData();
    for (const [key, value] of Object.entries({ productId: "clh1p2s3t0000qwertyuiopas", name: "Tea", sku: "TEA-001", unitPrice: "12.50", category: "Beverages" })) formData.set(key, value);
    expect((await updateProduct({ status: "idle", message: "" }, formData)).status).toBe("success");
    expect(productUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-1" }),
      data: expect.objectContaining({ categoryId: "category-1" }),
    }));
  });

  it("reports a duplicate SKU from the database as a validation error", async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test", meta: { target: ["organizationId", "sku"] } },
    );
    transaction.mockRejectedValue(error);

    const formData = new FormData();
    formData.set("name", "Tea");
    formData.set("sku", "TEA-001");
    formData.set("unitPrice", "12.50");
    formData.set("initialStock", "0");
    formData.set("reorderPoint", "0");

    const result = await createProduct({ status: "idle", message: "" }, formData);

    expect(result).toEqual({ status: "error", message: "That SKU is already in use in your business." });
    expect(transaction).toHaveBeenCalledOnce();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createProductVariantBatch", () => {
  const productId = "clh1p2s3t0000qwertyuiopas";
  const optionId = "clh1p2s3t0001qwertyuiopas";

  function batchForm() {
    const form = new FormData();
    form.set("productId", productId);
    form.set("options", JSON.stringify([{ optionId, values: ["Red", "Blue"] }]));
    form.set("unitPrice", "12.00");
    form.set("reorderPoint", "5");
    return form;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.MANAGER, userId: "user-1" },
      store: { id: "store-1" },
    });
    findProduct.mockResolvedValue({ id: productId });
    findOptions.mockResolvedValue([{ id: optionId }]);
    findVariants.mockResolvedValue([]);
    createVariant.mockResolvedValue({ id: "variant-1" });
    transaction.mockImplementation(async (callback) => callback({
      $queryRaw: queryRaw,
      product: { findFirst: findProduct },
      productOption: { findMany: findOptions },
      productVariant: { create: createVariant, findMany: findVariants },
      productVariantOption: { createMany: createVariantOptions },
      inventoryLevel: { create: inventoryCreate },
      auditLog: { create: auditCreate },
    }));
  });

  it("creates each combination with a generated SKU, inventory, and audit event in one transaction", async () => {
    const result = await createProductVariantBatch({ status: "idle", message: "" }, batchForm());
    expect(result.status).toBe("success");
    expect(transaction).toHaveBeenCalledOnce();
    expect(createVariant).toHaveBeenCalledTimes(2);
    const skus = createVariant.mock.calls.map(([args]) => args.data.sku);
    expect(new Set(skus).size).toBe(2);
    expect(skus.every((sku) => /^VAR-[A-F0-9]{32}$/.test(sku))).toBe(true);
    expect(createVariantOptions).toHaveBeenCalledTimes(2);
    expect(inventoryCreate).toHaveBeenCalledTimes(2);
    expect(auditCreate).toHaveBeenCalledTimes(2);
  });

  it("rejects existing combinations and unavailable options before writes", async () => {
    findVariants.mockResolvedValueOnce([{ optionValues: [{ optionId, value: "RED" }] }]);
    expect((await createProductVariantBatch({ status: "idle", message: "" }, batchForm())).message).toContain("already exists");
    expect(createVariant).not.toHaveBeenCalled();
    findOptions.mockResolvedValueOnce([]);
    expect((await createProductVariantBatch({ status: "idle", message: "" }, batchForm())).message).toContain("no longer available");
    expect(createVariant).not.toHaveBeenCalled();
  });

  it("rejects unauthorized users and oversized batches", async () => {
    getWorkspace.mockResolvedValueOnce({ organization: { id: "org-1" }, membership: { role: MembershipRole.CASHIER } });
    expect((await createProductVariantBatch({ status: "idle", message: "" }, batchForm())).message).toContain("cannot");
    const form = batchForm();
    form.set("options", JSON.stringify([{ optionId, values: Array.from({ length: 51 }, (_, index) => String(index)) }]));
    expect((await createProductVariantBatch({ status: "idle", message: "" }, form)).status).toBe("error");
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("createProductVariant", () => {
  const productId = "clh1p2s3t0000qwertyuiopas";
  const optionId = "clh1p2s3t0001qwertyuiopas";

  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.MANAGER, userId: "user-1" },
      store: { id: "store-1" },
    });
    queryRaw.mockResolvedValue([]);
    findProduct.mockResolvedValue({ id: productId });
    createVariant.mockResolvedValue({ id: "variant-2" });
    findOptions.mockResolvedValue([{ id: optionId }]);
    createVariantOptions.mockResolvedValue({ count: 1 });
    inventoryCreate.mockResolvedValue({});
    movementCreate.mockResolvedValue({});
    auditCreate.mockResolvedValue({});
    transaction.mockImplementation(async (callback) => callback({
      $queryRaw: queryRaw,
      product: { findFirst: findProduct },
      productVariant: { create: createVariant },
      productOption: { findMany: findOptions },
      productVariantOption: { createMany: createVariantOptions },
      inventoryLevel: { create: inventoryCreate },
      inventoryMovement: { create: movementCreate },
      auditLog: { create: auditCreate },
    }));
  });

  function variantFormData() {
    const formData = new FormData();
    formData.set("productId", productId);
    formData.set("name", "Large");
    formData.set("sku", "TEA-LARGE");
    formData.set("unitPrice", "15.00");
    formData.set("costPrice", "8.00");
    formData.set("initialStock", "4");
    formData.set("reorderPoint", "2");
    formData.set("optionValues", JSON.stringify([{ optionId, value: "Large" }]));
    return formData;
  }

  it("generates a SKU for an individual variant when left blank", async () => {
    const formData = variantFormData();
    formData.set("sku", "");
    expect((await createProductVariant({ status: "idle", message: "" }, formData)).status).toBe("success");
    expect(createVariant.mock.calls[0][0].data.sku).toMatch(/^VAR-[A-F0-9]{32}$/);
  });

  it("locks and validates the tenant product, then atomically adds options and opening stock", async () => {
    const result = await createProductVariant({ status: "idle", message: "" }, variantFormData());

    expect(result).toEqual({ status: "success", message: "Large was added to the product." });
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(findProduct).toHaveBeenCalledWith({
      where: { id: productId, organizationId: "org-1", archivedAt: null },
      select: { id: true },
    });
    expect(createVariant).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        productId,
        name: "Large",
        sku: "TEA-LARGE",
      }),
    });
    expect(findOptions).toHaveBeenCalledWith({
      where: { organizationId: "org-1", id: { in: [optionId] } },
      select: { id: true },
    });
    expect(createVariantOptions).toHaveBeenCalledWith({
      data: [{ organizationId: "org-1", variantId: "variant-2", optionId, value: "Large" }],
    });
    expect(inventoryCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        storeId: "store-1",
        variantId: "variant-2",
        quantity: 4,
        reorderPoint: 2,
      },
    });
    expect(movementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        storeId: "store-1",
        variantId: "variant-2",
        quantityDelta: 4,
        reason: "Variant opening stock",
      }),
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "product.variant_created",
        entityType: "ProductVariant",
        entityId: "variant-2",
        details: expect.objectContaining({ productId, sku: "TEA-LARGE", storeId: "store-1" }),
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/products");
    expect(revalidatePath).toHaveBeenCalledWith("/inventory");
    expect(revalidatePath).toHaveBeenCalledWith("/purchasing");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects unavailable products and cross-organization options without leaving partial writes", async () => {
    findProduct.mockResolvedValueOnce(null);

    const unavailable = await createProductVariant({ status: "idle", message: "" }, variantFormData());

    expect(unavailable).toEqual({
      status: "error",
      message: "That product is no longer available. Refresh the catalog and try again.",
    });
    expect(createVariant).not.toHaveBeenCalled();

    findProduct.mockResolvedValue({ id: productId });
    findOptions.mockResolvedValue([]);
    const unavailableOption = await createProductVariant({ status: "idle", message: "" }, variantFormData());

    expect(unavailableOption).toEqual({
      status: "error",
      message: "One or more product options are no longer available. Refresh and try again.",
    });
    expect(createVariantOptions).not.toHaveBeenCalled();
    expect(inventoryCreate).not.toHaveBeenCalled();
  });

  it("rejects invalid input and roles without starting a transaction", async () => {
    const invalid = await createProductVariant({ status: "idle", message: "" }, new FormData());
    expect(invalid.status).toBe("error");
    expect(getWorkspace).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();

    getWorkspace.mockResolvedValue({
      organization: { id: "org-1" },
      membership: { role: MembershipRole.CASHIER, userId: "user-1" },
      store: { id: "store-1" },
    });

    const denied = await createProductVariant({ status: "idle", message: "" }, variantFormData());

    expect(denied).toEqual({ status: "error", message: "Your role cannot add product variants." });
    expect(transaction).not.toHaveBeenCalled();
  });
});
