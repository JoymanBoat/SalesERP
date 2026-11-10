"use server";

import { InventoryMovementType, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { canManageCatalog } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { CatalogCsvError, parseProductImportCsv } from "@/lib/catalog";
import { buildVariantCombinations, variantBatchOptionsSchema, variantOptionKey } from "@/lib/variant-batch";
import {
  productInputSchema,
  productOptionSchema,
  productStatusSchema,
  productUpdateSchema,
  productVariantDeleteSchema,
  productVariantInputSchema,
  productVariantUpdateSchema,
} from "@/lib/validation";

export type ProductActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

function generatedSku() {
  return `VAR-${randomUUID().replaceAll("-", "").toUpperCase()}`;
}

function parseOptionValues(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || !value) return [];
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function validateProductOptionValues(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  optionValues: Array<{ optionId: string; value: string }>,
) {
  const values = optionValues.filter(({ value }) => value !== "");
  const options = await transaction.productOption.findMany({
    where: { organizationId, id: { in: values.map(({ optionId }) => optionId) } },
    select: { id: true },
  });
  if (options.length !== values.length) throw new Error("PRODUCT_OPTIONS_UNAVAILABLE");
  return values;
}

function isDuplicateSku(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  const targetNames = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? [target]
      : [];
  return targetNames.some((field) => field.toLowerCase().includes("sku")) ||
    error.message.includes("ProductVariant_organizationId_sku_key");
}

export async function createProduct(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const parsed = productInputSchema.safeParse({
    name: formData.get("name"),
    sku: formData.get("sku") || generatedSku(),
    barcode: formData.get("barcode") || undefined,
    category: formData.get("category") || undefined,
    unitPrice: formData.get("unitPrice"),
    costPrice: formData.get("costPrice") || "",
    initialStock: formData.get("initialStock"),
    reorderPoint: formData.get("reorderPoint"),
    taxTreatment: formData.get("taxTreatment") || undefined,
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the product details." };
  }

  const { organization, membership, store } = await getWorkspace({ feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot create products." };
  }
  const input = parsed.data;
  const categoryName = input.category?.trim() || undefined;

  try {
    await prisma.$transaction(async (transaction) => {
      const category = categoryName
        ? await transaction.category.findUnique({
            where: { organizationId_name: { organizationId: organization.id, name: categoryName } },
            select: { id: true },
          })
        : null;
      if (categoryName && !category) throw new Error("CATEGORY_NOT_AVAILABLE");

      const product = await transaction.product.create({
        data: {
          organizationId: organization.id,
          name: input.name,
          categoryId: category?.id,
          taxTreatment: input.taxTreatment,
          variants: {
            create: {
              sku: input.sku,
              barcode: input.barcode || null,
              unitPrice: new Prisma.Decimal(input.unitPrice),
              costPrice: input.costPrice ? new Prisma.Decimal(input.costPrice) : null,
            },
          },
        },
        include: { variants: true },
      });

      const variant = product.variants[0];
      await transaction.inventoryLevel.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          variantId: variant.id,
          quantity: input.initialStock,
          reorderPoint: input.reorderPoint,
        },
      });

      if (input.initialStock > 0) {
        await transaction.inventoryMovement.create({
          data: {
            organizationId: organization.id,
            storeId: store.id,
            variantId: variant.id,
            createdById: membership.userId,
            type: InventoryMovementType.RECEIPT,
            quantityDelta: input.initialStock,
            reason: "Opening stock",
            reference: product.id,
          },
        });
      }

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "product.created",
          entityType: "Product",
          entityId: product.id,
          details: {
            sku: input.sku,
            initialStock: input.initialStock,
            storeId: store.id,
          },
        },
      });
    });

    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { status: "success", message: `${input.name} was added to your catalog.` };
  } catch (error) {
    if (error instanceof Error && error.message === "CATEGORY_NOT_AVAILABLE") {
      return { status: "error", message: "That category is no longer available. Refresh the catalog and try again." };
    }
    if (isDuplicateSku(error)) {
      return { status: "error", message: "That SKU is already in use in your business." };
    }

    console.error("Product creation failed.", error);
    return { status: "error", message: "The product could not be saved. Please try again." };
  }
}

export async function importProducts(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a CSV file to import." };
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return { status: "error", message: "Choose a file with the .csv extension." };
  }
  if (file.size > 1_000_000) {
    return { status: "error", message: "The CSV file must be 1 MB or smaller." };
  }

  let products: ReturnType<typeof productInputSchema.parse>[];
  try {
    products = parseProductImportCsv(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof CatalogCsvError || error instanceof TypeError) {
      return { status: "error", message: error.message || "The file must be valid UTF-8 CSV." };
    }
    console.error("Product CSV parsing failed.", error);
    return { status: "error", message: "The CSV file could not be read." };
  }

  const { organization, membership, store } = await getWorkspace({ feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot import products." };
  }

  try {
    const existing = await prisma.productVariant.findMany({
      where: { organizationId: organization.id, sku: { in: products.map((product) => product.sku) } },
      select: { sku: true },
    });
    if (existing.length > 0) {
      return { status: "error", message: `SKU “${existing[0].sku}” is already in use in your business. No products were imported.` };
    }

    await prisma.$transaction(async (transaction) => {
      for (const input of products) {
        const categoryName = input.category?.trim();
        const category = categoryName
          ? await transaction.category.upsert({
              where: { organizationId_name: { organizationId: organization.id, name: categoryName } },
              create: { organizationId: organization.id, name: categoryName },
              update: {},
            })
          : null;
        const product = await transaction.product.create({
          data: {
            organizationId: organization.id,
            name: input.name,
            categoryId: category?.id,
            variants: {
              create: {
                sku: input.sku,
                barcode: input.barcode || null,
                unitPrice: new Prisma.Decimal(input.unitPrice),
                costPrice: input.costPrice ? new Prisma.Decimal(input.costPrice) : null,
              },
            },
          },
          include: { variants: true },
        });
        const variant = product.variants[0];
        await transaction.inventoryLevel.create({
          data: {
            organizationId: organization.id,
            storeId: store.id,
            variantId: variant.id,
            quantity: input.initialStock,
            reorderPoint: input.reorderPoint,
          },
        });
        if (input.initialStock > 0) {
          await transaction.inventoryMovement.create({
            data: {
              organizationId: organization.id,
              storeId: store.id,
              variantId: variant.id,
              createdById: membership.userId,
              type: InventoryMovementType.RECEIPT,
              quantityDelta: input.initialStock,
              reason: "Opening stock (CSV import)",
              reference: product.id,
            },
          });
        }
        await transaction.auditLog.create({
          data: {
            organizationId: organization.id,
            actorId: membership.userId,
            action: "product.imported",
            entityType: "Product",
            entityId: product.id,
            details: { sku: input.sku, initialStock: input.initialStock, storeId: store.id },
          },
        });
      }
    }, { maxWait: 10_000, timeout: 30_000 });

    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { status: "success", message: `${products.length} product${products.length === 1 ? "" : "s"} imported successfully.` };
  } catch (error) {
    if (isDuplicateSku(error)) {
      return { status: "error", message: "A SKU is already in use in your business. No products were imported." };
    }
    console.error("Product CSV import failed.", error);
    return { status: "error", message: "The CSV import failed. No products were imported." };
  }
}

export async function createProductVariantBatch(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const options = variantBatchOptionsSchema.safeParse(parseOptionValues(formData.get("options")));
  const input = productVariantInputSchema.safeParse({
    productId: formData.get("productId"),
    name: "Batch",
    sku: "BATCH",
    unitPrice: formData.get("unitPrice"),
    costPrice: formData.get("costPrice") || "",
    initialStock: "0",
    reorderPoint: formData.get("reorderPoint"),
  });
  if (!options.success || !input.success) {
    return { status: "error", message: options.error?.issues[0]?.message ?? input.error?.issues[0]?.message ?? "Check the variant details." };
  }
  const combinations = buildVariantCombinations(options.data);
  if (combinations.some((values) => values.map(({ value }) => value).join(" / ").length > 80)) {
    return { status: "error", message: "Each combined variant name must be at most 80 characters." };
  }
  const { organization, membership, store } = await getWorkspace({ feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot add product variants." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Product"
        WHERE "id" = ${input.data.productId} AND "organizationId" = ${organization.id}
        FOR UPDATE
      `;
      const product = await transaction.product.findFirst({
        where: { id: input.data.productId, organizationId: organization.id, archivedAt: null },
        select: { id: true },
      });
      if (!product) throw new Error("PRODUCT_NOT_AVAILABLE");
      await validateProductOptionValues(transaction, organization.id, options.data.map(({ optionId }) => ({ optionId, value: "x" })));
      const existing = await transaction.productVariant.findMany({
        where: { organizationId: organization.id, productId: product.id },
        select: { optionValues: { select: { optionId: true, value: true } } },
      });
      const existingKeys = new Set(existing.map(({ optionValues }) => variantOptionKey(optionValues)));
      if (combinations.some((values) => existingKeys.has(variantOptionKey(values)))) {
        throw new Error("VARIANT_COMBINATION_EXISTS");
      }

      for (const optionValues of combinations) {
        const name = optionValues.map(({ value }) => value).join(" / ");
        const sku = generatedSku();
        const variant = await transaction.productVariant.create({
          data: {
            organizationId: organization.id, productId: product.id, name, sku,
            unitPrice: new Prisma.Decimal(input.data.unitPrice),
            costPrice: input.data.costPrice ? new Prisma.Decimal(input.data.costPrice) : null,
          },
        });
        await transaction.productVariantOption.createMany({
          data: optionValues.map(({ optionId, value }) => ({ organizationId: organization.id, variantId: variant.id, optionId, value })),
        });
        await transaction.inventoryLevel.create({
          data: { organizationId: organization.id, storeId: store.id, variantId: variant.id, quantity: 0, reorderPoint: input.data.reorderPoint },
        });
        await transaction.auditLog.create({
          data: {
            organizationId: organization.id, actorId: membership.userId, action: "product.variant_created",
            entityType: "ProductVariant", entityId: variant.id,
            details: { productId: product.id, name, sku, storeId: store.id, options: optionValues },
          },
        });
      }
    }, { maxWait: 10_000, timeout: 30_000 });
    for (const path of ["/products", "/inventory", "/purchasing", "/dashboard"]) revalidatePath(path);
    return { status: "success", message: `${combinations.length} variants created with generated SKUs and zero opening stock.` };
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_NOT_AVAILABLE") {
      return { status: "error", message: "That product is no longer available. Refresh and try again." };
    }
    if (error instanceof Error && error.message === "PRODUCT_OPTIONS_UNAVAILABLE") {
      return { status: "error", message: "One or more product options are no longer available. Refresh and try again." };
    }
    if (error instanceof Error && error.message === "VARIANT_COMBINATION_EXISTS") {
      return { status: "error", message: "A variant with one of these option combinations already exists. No variants were created." };
    }
    console.error("Product variant batch creation failed.", error);
    return { status: "error", message: "The variant batch could not be saved. No variants were created." };
  }
}

export async function createProductVariant(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const parsed = productVariantInputSchema.safeParse({
    productId: formData.get("productId"),
    name: formData.get("name"),
    sku: formData.get("sku") || generatedSku(),
    barcode: formData.get("barcode") || undefined,
    unitPrice: formData.get("unitPrice"),
    costPrice: formData.get("costPrice") || "",
    initialStock: formData.get("initialStock"),
    reorderPoint: formData.get("reorderPoint"),
    optionValues: parseOptionValues(formData.get("optionValues")),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the variant details." };
  }

  const { organization, membership, store } = await getWorkspace({ feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot add product variants." };
  }

  const input = parsed.data;
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Product"
        WHERE "id" = ${input.productId} AND "organizationId" = ${organization.id}
        FOR UPDATE
      `;
      const product = await transaction.product.findFirst({
        where: { id: input.productId, organizationId: organization.id, archivedAt: null },
        select: { id: true },
      });
      if (!product) throw new Error("PRODUCT_NOT_AVAILABLE");

      const variant = await transaction.productVariant.create({
        data: {
          organizationId: organization.id,
          productId: product.id,
          name: input.name,
          sku: input.sku,
          barcode: input.barcode || null,
          unitPrice: new Prisma.Decimal(input.unitPrice),
          costPrice: input.costPrice ? new Prisma.Decimal(input.costPrice) : null,
        },
      });
      const optionValues = await validateProductOptionValues(transaction, organization.id, input.optionValues);
      if (optionValues.length) {
        await transaction.productVariantOption.createMany({
          data: optionValues.map(({ optionId, value }) => ({
            organizationId: organization.id,
            variantId: variant.id,
            optionId,
            value,
          })),
        });
      }
      await transaction.inventoryLevel.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          variantId: variant.id,
          quantity: input.initialStock,
          reorderPoint: input.reorderPoint,
        },
      });
      if (input.initialStock > 0) {
        await transaction.inventoryMovement.create({
          data: {
            organizationId: organization.id,
            storeId: store.id,
            variantId: variant.id,
            createdById: membership.userId,
            type: InventoryMovementType.RECEIPT,
            quantityDelta: input.initialStock,
            reason: "Variant opening stock",
            reference: product.id,
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "product.variant_created",
          entityType: "ProductVariant",
          entityId: variant.id,
          details: {
            productId: product.id,
            name: input.name,
            sku: input.sku,
            storeId: store.id,
            options: optionValues,
          },
        },
      });
    });

    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/purchasing");
    revalidatePath("/dashboard");
    return { status: "success", message: `${input.name} was added to the product.` };
  } catch (error) {
    if (isDuplicateSku(error)) {
      return { status: "error", message: "That SKU is already in use in your business." };
    }
    if (error instanceof Error && error.message === "PRODUCT_NOT_AVAILABLE") {
      return { status: "error", message: "That product is no longer available. Refresh the catalog and try again." };
    }
    if (error instanceof Error && error.message === "PRODUCT_OPTIONS_UNAVAILABLE") {
      return { status: "error", message: "One or more product options are no longer available. Refresh and try again." };
    }
    console.error("Product variant creation failed.", error);
    return { status: "error", message: "The variant could not be saved. Please try again." };
  }
}

export async function updateProductVariant(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const parsed = productVariantUpdateSchema.safeParse({
    productId: formData.get("productId"),
    variantId: formData.get("variantId"),
    name: formData.get("name"),
    sku: formData.get("sku"),
    barcode: formData.get("barcode") || undefined,
    unitPrice: formData.get("unitPrice"),
    costPrice: formData.get("costPrice") || "",
    optionValues: parseOptionValues(formData.get("optionValues")),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the variant details." };
  }
  const { organization, membership } = await getWorkspace({ feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot update product variants." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "ProductVariant"
        WHERE "id" = ${parsed.data.variantId}
          AND "organizationId" = ${organization.id}
          AND "productId" = ${parsed.data.productId}
        FOR UPDATE
      `;
      const optionValues = await validateProductOptionValues(transaction, organization.id, parsed.data.optionValues);
      const result = await transaction.productVariant.updateMany({
        where: {
          id: parsed.data.variantId,
          productId: parsed.data.productId,
          organizationId: organization.id,
          product: { archivedAt: null },
        },
        data: {
          name: parsed.data.name,
          sku: parsed.data.sku,
          barcode: parsed.data.barcode || null,
          unitPrice: new Prisma.Decimal(parsed.data.unitPrice),
          costPrice: parsed.data.costPrice ? new Prisma.Decimal(parsed.data.costPrice) : null,
        },
      });
      if (result.count !== 1) throw new Error("PRODUCT_VARIANT_NOT_AVAILABLE");
      await transaction.productVariantOption.deleteMany({
        where: { organizationId: organization.id, variantId: parsed.data.variantId },
      });
      if (optionValues.length) {
        await transaction.productVariantOption.createMany({
          data: optionValues.map(({ optionId, value }) => ({
            organizationId: organization.id,
            variantId: parsed.data.variantId,
            optionId,
            value,
          })),
        });
      }

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "product.variant_updated",
          entityType: "ProductVariant",
          entityId: parsed.data.variantId,
          details: {
            productId: parsed.data.productId,
            name: parsed.data.name,
            sku: parsed.data.sku,
            options: optionValues,
          },
        },
      });
    });
    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/purchasing");
    return { status: "success", message: `${parsed.data.name} was updated.` };
  } catch (error) {
    if (isDuplicateSku(error)) {
      return { status: "error", message: "That SKU is already in use in your business." };
    }
    if (error instanceof Error && error.message === "PRODUCT_VARIANT_NOT_AVAILABLE") {
      return { status: "error", message: "That variant is no longer available. Refresh the catalog and try again." };
    }
    if (error instanceof Error && error.message === "PRODUCT_OPTIONS_UNAVAILABLE") {
      return { status: "error", message: "One or more product options are no longer available. Refresh and try again." };
    }
    console.error("Product variant update failed.", error);
    return { status: "error", message: "The variant could not be updated. Please try again." };
  }
}

export async function createProductOption(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const parsed = productOptionSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter a valid product option." };
  const { organization, membership } = await getWorkspace({ feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) return { status: "error", message: "Your role cannot manage product options." };

  const name = parsed.data.name.toLowerCase();
  try {
    await prisma.$transaction(async (transaction) => {
      const option = await transaction.productOption.create({
        data: { organizationId: organization.id, name },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "product.option_created",
          entityType: "ProductOption",
          entityId: option.id,
          details: { name },
        },
      });
    });
    revalidatePath("/products");
    return { status: "success", message: `Reusable option “${name}” created.` };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "That option already exists in your catalog." };
    }
    console.error("Product option creation failed.", error);
    return { status: "error", message: "The product option could not be saved. Please try again." };
  }
}

export async function deleteProductVariant(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const parsed = productVariantDeleteSchema.safeParse({
    productId: formData.get("productId"),
    variantId: formData.get("variantId"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Select a valid variant." };

  const { organization, membership, store } = await getWorkspace({ feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot delete product variants." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Product"
        WHERE "id" = ${parsed.data.productId} AND "organizationId" = ${organization.id}
        FOR UPDATE
      `;
      const variant = await transaction.productVariant.findFirst({
        where: {
          id: parsed.data.variantId,
          productId: parsed.data.productId,
          organizationId: organization.id,
          product: { archivedAt: null },
        },
        select: { id: true, name: true, sku: true, productId: true },
      });
      if (!variant) throw new Error("PRODUCT_VARIANT_NOT_AVAILABLE");

      const variantCount = await transaction.productVariant.count({
        where: { organizationId: organization.id, productId: variant.productId },
      });
      if (variantCount <= 1) throw new Error("PRODUCT_VARIANT_LAST");

      await transaction.$queryRaw`
        SELECT "id" FROM "InventoryLevel"
        WHERE "organizationId" = ${organization.id} AND "variantId" = ${variant.id}
        ORDER BY "storeId"
        FOR UPDATE
      `;
      const inventoryLevels = await transaction.inventoryLevel.findMany({
        where: { organizationId: organization.id, variantId: variant.id },
        select: { quantity: true, reserved: true },
      });
      if (inventoryLevels.some((level) => level.quantity !== 0 || level.reserved !== 0)) {
        throw new Error("PRODUCT_VARIANT_HAS_STOCK");
      }

      const [
        movementCount,
        transferCount,
        orderItemCount,
        purchaseOrderItemCount,
        reservationCount,
      ] = await Promise.all([
        transaction.inventoryMovement.count({ where: { organizationId: organization.id, variantId: variant.id } }),
        transaction.stockTransfer.count({ where: { organizationId: organization.id, variantId: variant.id } }),
        transaction.orderItem.count({ where: { variantId: variant.id } }),
        transaction.purchaseOrderItem.count({ where: { variantId: variant.id } }),
        transaction.inventoryReservation.count({ where: { organizationId: organization.id, variantId: variant.id } }),
      ]);
      if (movementCount || transferCount || orderItemCount || purchaseOrderItemCount || reservationCount) {
        throw new Error("PRODUCT_VARIANT_HAS_HISTORY");
      }

      await transaction.productVariant.delete({ where: { id: variant.id } });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "product.variant_deleted",
          entityType: "ProductVariant",
          entityId: variant.id,
          details: {
            productId: variant.productId,
            name: variant.name,
            sku: variant.sku,
            storeId: store.id,
          },
        },
      });
    });

    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/purchasing");
    revalidatePath("/pos");
    revalidatePath("/dashboard");
    return { status: "success", message: "Variant deleted. Inventory records contained no stock or history." };
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_VARIANT_NOT_AVAILABLE") {
      return { status: "error", message: "That variant is no longer available. Refresh the catalog and try again." };
    }
    if (error instanceof Error && error.message === "PRODUCT_VARIANT_LAST") {
      return { status: "error", message: "A product must retain at least one variant." };
    }
    if (error instanceof Error && error.message === "PRODUCT_VARIANT_HAS_STOCK") {
      return { status: "error", message: "This variant has on-hand or reserved stock at one or more stores. Clear its inventory before deleting it." };
    }
    if (error instanceof Error && error.message === "PRODUCT_VARIANT_HAS_HISTORY") {
      return { status: "error", message: "This variant has inventory, transfer, reservation, sale, or purchase history and cannot be deleted." };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return { status: "error", message: "This variant is referenced by existing records and cannot be deleted." };
    }
    console.error("Product variant deletion failed.", error);
    return { status: "error", message: "The variant could not be deleted. Please try again." };
  }
}

export async function updateProduct(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const parsed = productUpdateSchema.safeParse({
    productId: formData.get("productId"),
    name: formData.get("name"),
    sku: formData.get("sku"),
    barcode: formData.get("barcode") || undefined,
    category: formData.get("category") || undefined,
    unitPrice: formData.get("unitPrice"),
    costPrice: formData.get("costPrice") || "",
    taxTreatment: formData.get("taxTreatment") || undefined,
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the product details." };
  }

  const { organization, membership } = await getWorkspace({ feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot update products." };
  }

  const { productId, ...input } = parsed.data;
  try {
    await prisma.$transaction(async (transaction) => {
      const categoryName = input.category?.trim() || undefined;
      const category = categoryName
        ? await transaction.category.findUnique({
            where: { organizationId_name: { organizationId: organization.id, name: categoryName } },
            select: { id: true },
          })
        : null;
      if (categoryName && !category) throw new Error("CATEGORY_NOT_AVAILABLE");

      const product = await transaction.product.updateMany({
        where: { id: productId, organizationId: organization.id, archivedAt: null },
        data: { name: input.name, categoryId: category?.id ?? null, taxTreatment: input.taxTreatment },
      });
      if (product.count !== 1) throw new Error("PRODUCT_NOT_AVAILABLE");

      const variant = await transaction.productVariant.findFirst({
        where: { organizationId: organization.id, productId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!variant) throw new Error("PRODUCT_VARIANT_NOT_AVAILABLE");

      await transaction.productVariant.update({
        where: { id: variant.id },
        data: {
          sku: input.sku,
          barcode: input.barcode || null,
          unitPrice: new Prisma.Decimal(input.unitPrice),
          costPrice: input.costPrice ? new Prisma.Decimal(input.costPrice) : null,
        },
      });

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "product.updated",
          entityType: "Product",
          entityId: productId,
          details: { sku: input.sku, taxTreatment: input.taxTreatment },
        },
      });
    });

    revalidatePath("/products");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { status: "success", message: `${input.name} was updated.` };
  } catch (error) {
    if (error instanceof Error && error.message === "CATEGORY_NOT_AVAILABLE") {
      return { status: "error", message: "That category is no longer available. Refresh the catalog and try again." };
    }
    if (isDuplicateSku(error)) {
      return { status: "error", message: "That SKU is already in use in your business." };
    }
    if (
      error instanceof Error &&
      (error.message === "PRODUCT_NOT_AVAILABLE" || error.message === "PRODUCT_VARIANT_NOT_AVAILABLE")
    ) {
      return { status: "error", message: "That product is no longer available. Refresh the catalog and try again." };
    }

    console.error("Product update failed.", error);
    return { status: "error", message: "The product could not be updated. Please try again." };
  }
}

export async function setProductArchived(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const parsed = productStatusSchema.safeParse({
    productId: formData.get("productId"),
    archived: formData.get("archived"),
  });
  if (!parsed.success) {
    return { status: "error", message: "That product status request is invalid." };
  }

  const { organization, membership } = await getWorkspace({ feature: "inventory", operation: "change" });
  if (!canManageCatalog(membership.role)) {
    return { status: "error", message: "Your role cannot change product status." };
  }

  const { productId, archived } = parsed.data;
  try {
    await prisma.$transaction(async (transaction) => {
      const result = await transaction.product.updateMany({
        where: {
          id: productId,
          organizationId: organization.id,
          archivedAt: archived ? null : { not: null },
        },
        data: { archivedAt: archived ? new Date() : null },
      });
      if (result.count !== 1) throw new Error("PRODUCT_STATUS_UNCHANGED");

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: archived ? "product.archived" : "product.reactivated",
          entityType: "Product",
          entityId: productId,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_STATUS_UNCHANGED") {
      return { status: "error", message: "That product status has changed. Refresh the catalog and try again." };
    }

    console.error("Product status update failed.", error);
    return { status: "error", message: "The product status could not be updated. Please try again." };
  }

  revalidatePath("/products");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  redirect(archived ? "/products?status=archived&notice=archived" : "/products?notice=reactivated");
}
