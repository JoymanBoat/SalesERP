import { z } from "zod";

import { isCalendarDate } from "./calendar-date";
import { TAX_TREATMENTS } from "./tax";

export const credentialsSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
});

export const passwordResetSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This password-reset link is invalid or expired."),
  password: z.string().min(12).max(128),
});

export const registrationSchema = z
  .object({
    ownerName: z.string().trim().min(2).max(100),
    businessName: z.string().trim().min(2).max(120),
    storeName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(128),
  });

const moneyInput = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, "Enter an amount with up to two decimal places.");

const registerCashInput = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/, "Enter an amount from 0 to 99,999,999.99 with up to two decimal places.");

export const registerShiftOpenSchema = z.object({
  openingCash: registerCashInput,
  note: z.string().trim().max(160).optional(),
});

export const registerShiftCloseSchema = z.object({
  shiftId: z.string().cuid(),
  closingCash: registerCashInput,
  note: z.string().trim().max(160).optional(),
});

const saleLineSchema = z.object({
  variantId: z.string().cuid(),
  quantity: z.number().int().min(1).max(1_000_000),
});

export const offlineCartSnapshotSchema = z.object({
  version: z.literal(1),
  savedAt: z.string().datetime(),
  expectedUpdatedAt: z.string().datetime().optional(),
  lines: z.array(saleLineSchema).max(100),
}).refine(
  (value) => new Set(value.lines.map((line) => line.variantId)).size === value.lines.length,
  "A product can only appear once in the saved cart.",
);

export const saleDraftSchema = z.object({
  orderId: z.union([z.literal(""), z.string().cuid()]).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
  customerId: z.union([z.literal(""), z.string().cuid()]).optional(),
  discountTotal: moneyInput.optional().default("0"),
  promotionCode: z.string().trim().max(32).transform((value) => value.toUpperCase()).optional().default(""),
  giftCardCode: z.string().trim().max(40).optional().default(""),
  giftCardId: z.union([z.literal(""), z.string().cuid()]).optional().default(""),
  loyaltyPointsRedeemed: z.coerce.number().int().min(0).max(1_000_000_000).optional().default(0),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(saleLineSchema).min(1, "Add at least one product to the sale.").max(100),
}).refine(
  (value) => new Set(value.lines.map((line) => line.variantId)).size === value.lines.length,
  "A product can only appear once in the sale.",
).refine(
  (value) => !value.promotionCode || Number(value.discountTotal) === 0,
  "Use either a promotion code or a manual discount, not both.",
).refine(
  (value) => value.loyaltyPointsRedeemed === 0 || (!value.promotionCode && Number(value.discountTotal) === 0),
  "Loyalty points cannot be combined with a promotion or manual discount.",
).refine(
  (value) => value.loyaltyPointsRedeemed === 0 || Boolean(value.customerId),
  "Select a customer to redeem loyalty points.",
).refine(
  (value) => !value.orderId || Boolean(value.expectedUpdatedAt),
  "Refresh this held cart before saving it.",
);

export const cashCheckoutSchema = z.object({
  orderId: z.string().cuid(),
  cashReceived: moneyInput,
});

export const refundSchema = z.object({
  orderId: z.string().cuid(),
  amount: moneyInput.refine((value) => Number(value) > 0, "Refund must be greater than zero."),
  reason: z.string().trim().min(3).max(160),
  idempotencyKey: z.string().uuid(),
});

export const saleReturnSchema = z.object({
  orderId: z.string().cuid(),
  reason: z.string().trim().min(3).max(160),
  idempotencyKey: z.string().uuid(),
  lines: z.array(z.object({
    itemId: z.string().cuid(),
    quantity: z.number().int().min(1).max(1_000_000),
    restock: z.boolean(),
  })).min(1, "Enter at least one item to return.").max(100),
}).refine(
  (value) => new Set(value.lines.map((line) => line.itemId)).size === value.lines.length,
  "A sale item can only be returned once per request.",
);

export const voidSaleSchema = z.object({
  orderId: z.string().cuid(),
  reason: z.string().trim().min(3).max(160),
});

const taxRateInput = z.string().trim().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/, "Enter each tax rate with up to two decimal places.")
  .refine((value) => Number(value) <= 100, "Tax rates must be between 0 and 100 percent.");

export const taxSettingsSchema = z.object({
  vat: taxRateInput,
  nhil: taxRateInput,
  getfund: taxRateInput,
  effectiveFrom: calendarDateInput("Enter a valid effective date."),
}).refine(
  (value) => Number(value.vat) + Number(value.nhil) + Number(value.getfund) <= 100,
  { message: "Combined tax rates cannot exceed 100 percent.", path: ["vat"] },
);

export const promotionInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a promotion name.").max(80),
  code: z.string().trim().min(3, "Promotion codes must have at least 3 characters.")
    .max(32).regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, dashes, or underscores for the code.")
    .transform((value) => value.toUpperCase()),
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: moneyInput.refine((value) => Number(value) > 0, "Promotion value must be greater than zero."),
  maxRedemptions: z.union([
    z.literal(""),
    z.coerce.number().int().min(1).max(1_000_000),
  ]).optional().transform((value) => value === "" ? null : value),
  productIds: z.array(z.string().cuid()).max(500, "A promotion can target at most 500 products.").optional().default([]),
  minimumSubtotal: moneyInput.optional().default("0"),
  startsOn: calendarDateInput("Enter a valid start date.").optional().transform((value) => value || null),
  endsOn: calendarDateInput("Enter a valid end date.").optional().transform((value) => value || null),
}).refine(
  (value) => value.type !== "PERCENTAGE" || Number(value.value) <= 100,
  { message: "Percentage promotions cannot exceed 100 percent.", path: ["value"] },
).refine(
  (value) => !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn,
  { message: "Promotion end date cannot be before its start date.", path: ["endsOn"] },
).refine(
  (value) => new Set(value.productIds).size === value.productIds.length,
  { message: "A product can only be selected once.", path: ["productIds"] },
);

export const promotionStatusSchema = z.object({
  promotionId: z.string().cuid(),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const giftCardIssueSchema = z.object({
  amount: moneyInput.refine((value) => Number(value) > 0, "Gift card value must be greater than zero."),
  expiresOn: calendarDateInput("Enter a valid expiry date.").optional().default(""),
});

export const giftCardStatusSchema = z.object({
  giftCardId: z.string().cuid(),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const productInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sku: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dots, dashes, or underscores for the SKU."),
  barcode: z.string().trim().max(64).optional(),
  category: z.string().trim().max(80).optional(),
  unitPrice: moneyInput.refine((value) => Number(value) > 0, "Selling price must be greater than zero."),
  costPrice: z.union([moneyInput, z.literal("")]).optional(),
  initialStock: z.coerce.number().int().min(0).max(1_000_000),
  reorderPoint: z.coerce.number().int().min(0).max(1_000_000),
  taxTreatment: z.enum(TAX_TREATMENTS).default("STANDARD"),
});

export const productUpdateSchema = productInputSchema.omit({
  initialStock: true,
  reorderPoint: true,
}).extend({
  productId: z.string().cuid(),
});

export const productVariantInputSchema = z.object({
  productId: z.string().cuid(),
  name: z.string().trim().min(1).max(80),
  sku: productInputSchema.shape.sku,
  barcode: productInputSchema.shape.barcode,
  unitPrice: productInputSchema.shape.unitPrice,
  costPrice: productInputSchema.shape.costPrice,
  initialStock: productInputSchema.shape.initialStock,
  reorderPoint: productInputSchema.shape.reorderPoint,
  optionValues: z.array(z.object({
    optionId: z.string().cuid(),
    value: z.string().trim().max(80),
  })).max(20).refine(
    (values) => new Set(values.map(({ optionId }) => optionId)).size === values.length,
    "An option can only be assigned once per variant.",
  ).optional().default([]),
});

export const productVariantUpdateSchema = productVariantInputSchema.omit({
  initialStock: true,
  reorderPoint: true,
}).extend({
  variantId: z.string().cuid(),
});

export const productOptionSchema = z.object({
  name: z.string().trim().min(1, "Enter an option name.").max(40)
    .transform((value) => value.replace(/\s+/g, " ")),
});

export const productVariantDeleteSchema = z.object({
  productId: z.string().cuid(),
  variantId: z.string().cuid(),
});

export const productStatusSchema = z.object({
  productId: z.string().cuid(),
  archived: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const inventoryAdjustmentSchema = z.object({
  variantId: z.string().cuid(),
  quantityDelta: z.coerce.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0, "Enter a non-zero stock change."),
  reason: z.string().trim().min(3).max(160),
});

export const inventoryReorderPointSchema = z.object({
  variantId: z.string().cuid(),
  expectedReorderPoint: z.coerce.number().int().min(0).max(1_000_000),
  reorderPoint: z.coerce.number().int().min(0).max(1_000_000),
});

export const damagedStockSchema = z.object({
  variantId: z.string().cuid(),
  quantity: z.coerce.number().int().min(1, "Enter at least one damaged unit.").max(1_000_000),
  reason: z.string().trim().min(3).max(160),
});

export const inventoryCountSchema = z.object({
  variantId: z.string().cuid(),
  expectedQuantity: z.coerce.number().int().min(0).max(1_000_000),
  countedQuantity: z.coerce.number().int().min(0).max(1_000_000),
  reason: z.string().trim().min(3).max(160),
});

export const stockTransferSchema = z.object({
  variantId: z.string().cuid(),
  toStoreId: z.string().cuid(),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  reason: z.string().trim().min(3).max(160),
});

export const customerInputSchema = z.object({
  firstName: z.string().trim().min(2, "Enter a customer name.").max(80),
  lastName: z.string().trim().max(80).optional(),
  email: z.union([
    z.string().trim().email("Enter a valid email address.").max(254).transform((value) => value.toLowerCase()),
    z.literal(""),
  ]).optional(),
  phone: z.union([
    z.string().trim().min(7, "Enter a valid phone number.").max(32).regex(/^[+0-9().\-\s]+$/, "Use a valid phone number."),
    z.literal(""),
  ]).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const customerUpdateSchema = customerInputSchema.extend({
  customerId: z.string().cuid(),
});

export const customerStatusSchema = z.object({
  customerId: z.string().cuid(),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const supplierInputSchema = z.object({
  businessName: z.string().trim().min(2, "Enter a supplier business name.").max(120),
  contactName: z.string().trim().max(100).optional(),
  email: z.union([
    z.string().trim().email("Enter a valid email address.").max(254).transform((value) => value.toLowerCase()),
    z.literal(""),
  ]).optional(),
  phone: z.union([
    z.string().trim().min(7, "Enter a valid phone number.").max(32).regex(/^[+0-9().\-\s]+$/, "Use a valid phone number."),
    z.literal(""),
  ]).optional(),
  address: z.string().trim().max(240).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const supplierUpdateSchema = supplierInputSchema.extend({
  supplierId: z.string().cuid(),
});

export const supplierStatusSchema = z.object({
  supplierId: z.string().cuid(),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

const purchaseOrderLineSchema = z.object({
  variantId: z.string().cuid(),
  quantity: z.number().int().min(1).max(1_000_000),
  unitCost: moneyInput,
});

export const purchaseOrderInputSchema = z.object({
  supplierId: z.string().cuid(),
  expectedAt: z.union([
    z.literal(""),
    z.string().refine(isCalendarDate, "Enter a valid expected date."),
  ]).optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(purchaseOrderLineSchema).min(1, "Add at least one product to the order.").max(50),
}).refine(
  (value) => new Set(value.lines.map((line) => line.variantId)).size === value.lines.length,
  "Each product can only be listed once per purchase order.",
);

export const supplierFollowUpSchema = z.object({
  purchaseOrderId: z.string().cuid(),
  method: z.enum(["PHONE", "EMAIL", "IN_PERSON", "OTHER"]),
  summary: z.string().trim().min(3, "Enter a short summary of the supplier contact.").max(500),
  followUpAt: calendarDateInput("Enter a valid follow-up date.").optional().transform((value) => value || null),
});

export const purchaseOrderReceiveSchema = z.object({
  purchaseOrderId: z.string().cuid(),
  lines: z.array(z.object({
    itemId: z.string().cuid(),
    quantity: z.number().int().min(0).max(1_000_000),
  })).min(1).max(50),
}).refine(
  (value) => value.lines.some((line) => line.quantity > 0),
  "Enter at least one quantity to receive.",
).refine(
  (value) => new Set(value.lines.map((line) => line.itemId)).size === value.lines.length,
  "A purchase order line cannot be repeated.",
);

export const supplierReturnSchema = z.object({
  purchaseOrderId: z.string().cuid(),
  itemId: z.string().cuid(),
  quantity: z.coerce.number().int().min(1, "Enter at least one unit to return.").max(1_000_000),
  reason: z.string().trim().min(3, "Enter a return reason.").max(160),
});

function calendarDateInput(message: string) {
  return z.union([
    z.literal(""),
    z.string().refine(isCalendarDate, message),
  ]);
}

export const supplierInvoiceSchema = z.object({
  purchaseOrderId: z.string().cuid(),
  invoiceNumber: z.string().trim().min(1).max(80).transform((value) => value.toUpperCase()),
  amount: moneyInput.refine((value) => Number(value) > 0, "Invoice amount must be greater than zero."),
  invoiceDate: calendarDateInput("Enter a valid date.").optional(),
  dueDate: calendarDateInput("Enter a valid date.").optional(),
  note: z.string().trim().max(240).optional(),
}).refine(
  (value) => !value.invoiceDate || !value.dueDate || value.dueDate >= value.invoiceDate,
  { message: "Due date cannot be before the invoice date.", path: ["dueDate"] },
);

export const supplierInvoiceDueDateSchema = z.object({
  invoiceId: z.string().cuid(),
  dueDate: calendarDateInput("Enter a valid date.").optional(),
});

export const supplierInvoicePaymentSchema = z.object({
  invoiceId: z.string().cuid(),
  amount: moneyInput.refine((value) => Number(value) > 0, "Payment must be greater than zero."),
  paymentDate: calendarDateInput("Enter a valid date.").optional(),
  method: z.enum(["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "OTHER"]),
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(160).optional(),
  idempotencyKey: z.string().uuid(),
});

export const supplierCreditNoteSchema = z.object({
  invoiceId: z.string().cuid(),
  creditNoteNumber: z.string().trim().min(1).max(80).transform((value) => value.toUpperCase()),
  amount: moneyInput.refine((value) => Number(value) > 0, "Credit amount must be greater than zero."),
  issueDate: calendarDateInput("Enter a valid date.").optional(),
  reason: z.string().trim().min(3).max(160),
  idempotencyKey: z.string().uuid(),
});

export const addOrganizationMemberSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(["MANAGER", "CASHIER", "INVENTORY_MANAGER", "ACCOUNTANT", "CUSTOMER_SUPPORT"]),
  storeIds: z.array(z.string().cuid()).min(1, "Assign access to at least one active store.").max(100)
    .refine((storeIds) => new Set(storeIds).size === storeIds.length, "A store cannot be assigned more than once."),
  registerIds: z.array(z.string().cuid()).max(100)
    .refine((registerIds) => new Set(registerIds).size === registerIds.length, "A register cannot be assigned more than once."),
});

export const updateOrganizationMemberRoleSchema = z.object({
  membershipId: z.string().cuid(),
  role: z.enum(["MANAGER", "CASHIER", "INVENTORY_MANAGER", "ACCOUNTANT", "CUSTOMER_SUPPORT"]),
});

export const removeOrganizationMemberSchema = z.object({
  membershipId: z.string().cuid(),
});

export const organizationMemberStoresSchema = z.object({
  membershipId: z.string().cuid(),
  storeIds: z.array(z.string().cuid()).min(1, "Assign access to at least one active store.").max(100)
    .refine((storeIds) => new Set(storeIds).size === storeIds.length, "A store cannot be assigned more than once."),
});

export const organizationMemberRegistersSchema = z.object({
  membershipId: z.string().cuid(),
  registerIds: z.array(z.string().cuid()).max(100)
    .refine((registerIds) => new Set(registerIds).size === registerIds.length, "A register cannot be assigned more than once."),
});

export const posRegisterInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a register name.").max(80),
  code: z.string().trim().min(2, "Register code must be at least 2 characters.")
    .max(16, "Register code cannot exceed 16 characters.")
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, numbers, hyphens, or underscores in the register code.")
    .transform((value) => value.toUpperCase()),
});

export const posRegisterUpdateSchema = posRegisterInputSchema.extend({
  registerId: z.string().cuid(),
});

export const posRegisterStatusSchema = z.object({
  registerId: z.string().cuid(),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const posRegisterSelectionSchema = z.object({
  registerId: z.string().cuid(),
});

const storeInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a store name.").max(120),
  code: z.string().trim().min(2, "Store code must be at least 2 characters.")
    .max(24, "Store code cannot exceed 24 characters.")
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, numbers, hyphens, or underscores in the store code.")
    .transform((value) => value.toUpperCase()),
  address: z.string().trim().max(240).optional().transform((value) => value || null),
});

export const storeCreateSchema = storeInputSchema;

export const storeUpdateSchema = storeInputSchema.extend({
  storeId: z.string().cuid(),
});

export const storeStatusSchema = z.object({
  storeId: z.string().cuid(),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const storeSelectionSchema = z.object({
  storeId: z.string().cuid(),
});

export const purchaseOrderCancelSchema = z.object({
  purchaseOrderId: z.string().cuid(),
});

export function slugify(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return slug || "retail-business";
}
