"use server";

import { InventoryMovementType, PaymentMethod, Prisma, PurchaseOrderStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { canManageSupplierInvoices, canManageSuppliers } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  supplierCreditNoteRequestMatches,
  supplierInvoicePaymentRequestMatches,
} from "@/lib/supplier-accounting";
import { getMutationWorkspace } from "@/lib/workspace";
import {
  purchaseOrderCancelSchema,
  purchaseOrderInputSchema,
  purchaseOrderReceiveSchema,
  supplierFollowUpSchema,
  supplierCreditNoteSchema,
  supplierInvoiceDueDateSchema,
  supplierInvoicePaymentSchema,
  supplierInvoiceSchema,
  supplierReturnSchema,
} from "@/lib/validation";
import { businessDateInTimeZone } from "@/lib/pos";

export type PurchasingActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

function parseJsonField(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function recordSupplierInvoice(
  _previousState: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "purchasing", operation: "change" });
  if (!canManageSupplierInvoices(membership.role)) {
    return { status: "error", message: "Your role cannot record supplier invoices." };
  }
  const defaultInvoiceDate = businessDateInTimeZone(new Date(), organization.timezone);
  const parsed = supplierInvoiceSchema.safeParse({
    purchaseOrderId: formData.get("purchaseOrderId"),
    invoiceNumber: formData.get("invoiceNumber"),
    amount: formData.get("amount"),
    invoiceDate: formData.get("invoiceDate") || defaultInvoiceDate,
    dueDate: formData.get("dueDate") || "",
    note: formData.get("note") || "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the supplier invoice details." };
  const invoiceDateKey = parsed.data.invoiceDate || defaultInvoiceDate;

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "PurchaseOrder"
        WHERE "id" = ${parsed.data.purchaseOrderId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
        FOR UPDATE
      `;
      const order = await transaction.purchaseOrder.findFirst({
        where: {
          id: parsed.data.purchaseOrderId,
          organizationId: organization.id,
          storeId: store.id,
          status: { not: PurchaseOrderStatus.CANCELLED },
        },
        select: { id: true, number: true, supplierId: true },
      });
      if (!order) throw new Error("SUPPLIER_INVOICE_ORDER_UNAVAILABLE");

      const invoice = await transaction.supplierInvoice.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          supplierId: order.supplierId,
          purchaseOrderId: order.id,
          createdById: membership.userId,
          invoiceNumber: parsed.data.invoiceNumber,
          amount: new Prisma.Decimal(parsed.data.amount),
          invoiceDate: new Date(`${invoiceDateKey}T00:00:00.000Z`),
          dueDate: parsed.data.dueDate
            ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`)
            : null,
          note: parsed.data.note || null,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "supplier_invoice.recorded",
          entityType: "SupplierInvoice",
          entityId: invoice.id,
          details: {
            invoiceNumber: invoice.invoiceNumber,
            purchaseOrderId: order.id,
            purchaseOrderNumber: order.number,
            supplierId: order.supplierId,
            amount: invoice.amount.toString(),
            invoiceDate: invoice.invoiceDate.toISOString(),
            dueDate: invoice.dueDate?.toISOString() ?? null,
            note: invoice.note,
          },
        },
      });
    });
    revalidatePath("/purchasing");
    return { status: "success", message: "Supplier invoice recorded." };
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_INVOICE_ORDER_UNAVAILABLE") {
      return { status: "error", message: "Invoices can only be recorded against an available purchase order." };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "That invoice number is already recorded for this supplier." };
    }
    console.error("Supplier invoice recording failed.", error);
    return { status: "error", message: "The supplier invoice could not be recorded. Please try again." };
  }
}

export async function updateSupplierInvoiceDueDate(
  _previousState: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const parsed = supplierInvoiceDueDateSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    dueDate: formData.get("dueDate") || "",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the invoice due date." };
  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "purchasing", operation: "change" });
  if (!canManageSupplierInvoices(membership.role)) {
    return { status: "error", message: "Your role cannot update supplier invoice due dates." };
  }

  try {
    const updated = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "SupplierInvoice"
        WHERE "id" = ${parsed.data.invoiceId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
        FOR UPDATE
      `;
      const invoice = await transaction.supplierInvoice.findFirst({
        where: { id: parsed.data.invoiceId, organizationId: organization.id, storeId: store.id },
        select: { id: true, invoiceNumber: true, supplierId: true, amount: true, invoiceDate: true, dueDate: true },
      });
      if (!invoice) throw new Error("SUPPLIER_INVOICE_NOT_FOUND");
      const dueDateKey = parsed.data.dueDate || null;
      if (dueDateKey && dueDateKey < invoice.invoiceDate.toISOString().slice(0, 10)) {
        throw new Error("SUPPLIER_INVOICE_DUE_DATE_BEFORE_INVOICE");
      }
      if ((invoice.dueDate?.toISOString().slice(0, 10) ?? null) === dueDateKey) return false;

      const [payments, credits] = await Promise.all([
        transaction.supplierInvoicePayment.aggregate({
          where: { supplierInvoiceId: invoice.id },
          _sum: { amount: true },
        }),
        transaction.supplierCreditNote.aggregate({
          where: { supplierInvoiceId: invoice.id },
          _sum: { amount: true },
        }),
      ]);
      const outstanding = invoice.amount
        .minus(payments._sum.amount ?? new Prisma.Decimal(0))
        .minus(credits._sum.amount ?? new Prisma.Decimal(0));
      if (outstanding.lessThanOrEqualTo(0)) throw new Error("SUPPLIER_INVOICE_NOT_OUTSTANDING");

      await transaction.supplierInvoice.update({
        where: { id: invoice.id },
        data: { dueDate: dueDateKey ? new Date(`${dueDateKey}T00:00:00.000Z`) : null },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "supplier_invoice.due_date_updated",
          entityType: "SupplierInvoice",
          entityId: invoice.id,
          details: {
            invoiceNumber: invoice.invoiceNumber,
            supplierId: invoice.supplierId,
            previousDueDate: invoice.dueDate?.toISOString() ?? null,
            dueDate: dueDateKey,
          },
        },
      });
      return true;
    });
    revalidatePath("/purchasing");
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    return {
      status: "success",
      message: updated
        ? parsed.data.dueDate ? "Supplier invoice due date updated." : "Supplier invoice due date removed."
        : "That due date is already current.",
    };
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_INVOICE_NOT_FOUND") {
      return { status: "error", message: "That supplier invoice is unavailable. Refresh and try again." };
    }
    if (error instanceof Error && error.message === "SUPPLIER_INVOICE_DUE_DATE_BEFORE_INVOICE") {
      return { status: "error", message: "Due date cannot be before the invoice date." };
    }
    if (error instanceof Error && error.message === "SUPPLIER_INVOICE_NOT_OUTSTANDING") {
      return { status: "error", message: "Only outstanding invoices can have their due dates updated." };
    }
    console.error("Supplier invoice due-date update failed.", error);
    return { status: "error", message: "The supplier invoice due date could not be updated. Please try again." };
  }
}

export async function recordSupplierInvoicePayment(
  _previousState: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "purchasing", operation: "change" });
  if (!canManageSupplierInvoices(membership.role)) {
    return { status: "error", message: "Your role cannot record supplier payments." };
  }
  const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
  const parsed = supplierInvoicePaymentSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    amount: formData.get("amount"),
    paymentDate: formData.get("paymentDate") || businessDate,
    method: formData.get("method"),
    reference: formData.get("reference") || "",
    note: formData.get("note") || "",
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the supplier payment details." };
  const paymentDateKey = parsed.data.paymentDate || businessDate;
  if (paymentDateKey > businessDate) {
    return { status: "error", message: "Payment date cannot be in the future." };
  }

  try {
    const recorded = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "SupplierInvoice"
        WHERE "id" = ${parsed.data.invoiceId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
        FOR UPDATE
      `;
      const invoice = await transaction.supplierInvoice.findFirst({
        where: { id: parsed.data.invoiceId, organizationId: organization.id, storeId: store.id },
        select: { id: true, supplierId: true, invoiceNumber: true, amount: true },
      });
      if (!invoice) throw new Error("SUPPLIER_INVOICE_NOT_FOUND");

      const priorPayment = await transaction.supplierInvoicePayment.findUnique({
        where: { idempotencyKey: parsed.data.idempotencyKey },
        select: {
          id: true,
          supplierInvoiceId: true,
          amount: true,
          method: true,
          reference: true,
          note: true,
          paidAt: true,
        },
      });
      if (priorPayment) {
        if (priorPayment.supplierInvoiceId !== invoice.id) {
          throw new Error("SUPPLIER_PAYMENT_IDEMPOTENCY_CONFLICT");
        }
        if (!supplierInvoicePaymentRequestMatches(
          {
            amount: priorPayment.amount.toString(),
            paymentDate: priorPayment.paidAt.toISOString().slice(0, 10),
            method: priorPayment.method,
            reference: priorPayment.reference,
            note: priorPayment.note,
          },
          parsed.data,
        )) {
          throw new Error("SUPPLIER_PAYMENT_IDEMPOTENCY_PAYLOAD_CONFLICT");
        }
        return false;
      }
      const [payments, credits] = await Promise.all([
        transaction.supplierInvoicePayment.aggregate({
          where: { supplierInvoiceId: invoice.id },
          _sum: { amount: true },
        }),
        transaction.supplierCreditNote.aggregate({
          where: { supplierInvoiceId: invoice.id },
          _sum: { amount: true },
        }),
      ]);
      const outstanding = invoice.amount
        .minus(payments._sum.amount ?? new Prisma.Decimal(0))
        .minus(credits._sum.amount ?? new Prisma.Decimal(0));
      const amount = new Prisma.Decimal(parsed.data.amount);
      if (outstanding.lessThanOrEqualTo(0) || amount.greaterThan(outstanding)) {
        throw new Error("SUPPLIER_PAYMENT_EXCEEDS_BALANCE");
      }

      await transaction.supplierInvoicePayment.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          supplierInvoiceId: invoice.id,
          createdById: membership.userId,
          amount,
          method: PaymentMethod[parsed.data.method],
          reference: parsed.data.reference || null,
          note: parsed.data.note || null,
          paidAt: new Date(`${paymentDateKey}T00:00:00.000Z`),
          idempotencyKey: parsed.data.idempotencyKey,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "supplier_invoice.payment_recorded",
          entityType: "SupplierInvoice",
          entityId: invoice.id,
          details: {
            invoiceNumber: invoice.invoiceNumber,
            supplierId: invoice.supplierId,
            amount: amount.toString(),
            paymentDate: paymentDateKey,
            method: parsed.data.method,
            reference: parsed.data.reference || null,
            note: parsed.data.note || null,
          },
        },
      });
      return true;
    });
    revalidatePath("/purchasing");
    return { status: "success", message: recorded ? "Supplier payment recorded." : "This payment request was already recorded." };
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_INVOICE_NOT_FOUND") {
      return { status: "error", message: "That supplier invoice is unavailable. Refresh and try again." };
    }
    if (error instanceof Error && error.message === "SUPPLIER_PAYMENT_EXCEEDS_BALANCE") {
      return { status: "error", message: "Payment exceeds the invoice balance after recorded credits and payments." };
    }
    if (error instanceof Error && error.message === "SUPPLIER_PAYMENT_IDEMPOTENCY_CONFLICT") {
      return { status: "error", message: "This payment request key was already used for a different invoice." };
    }
    if (error instanceof Error && error.message === "SUPPLIER_PAYMENT_IDEMPOTENCY_PAYLOAD_CONFLICT") {
      return { status: "error", message: "This payment request key was already used with different payment details." };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "This supplier payment was already recorded." };
    }
    console.error("Supplier payment recording failed.", error);
    return { status: "error", message: "The supplier payment could not be recorded. Please try again." };
  }
}

export async function recordSupplierCreditNote(
  _previousState: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "purchasing", operation: "change" });
  if (!canManageSupplierInvoices(membership.role)) {
    return { status: "error", message: "Your role cannot record supplier credit notes." };
  }
  const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
  const parsed = supplierCreditNoteSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    creditNoteNumber: formData.get("creditNoteNumber"),
    amount: formData.get("amount"),
    issueDate: formData.get("issueDate") || businessDate,
    reason: formData.get("reason"),
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the supplier credit note details." };
  const issueDateKey = parsed.data.issueDate || businessDate;
  if (issueDateKey > businessDate) {
    return { status: "error", message: "Credit-note issue date cannot be in the future." };
  }

  try {
    const recorded = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "SupplierInvoice"
        WHERE "id" = ${parsed.data.invoiceId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
        FOR UPDATE
      `;
      const invoice = await transaction.supplierInvoice.findFirst({
        where: { id: parsed.data.invoiceId, organizationId: organization.id, storeId: store.id },
        select: { id: true, supplierId: true, invoiceNumber: true },
      });
      if (!invoice) throw new Error("SUPPLIER_INVOICE_NOT_FOUND");

      const priorCredit = await transaction.supplierCreditNote.findUnique({
        where: { idempotencyKey: parsed.data.idempotencyKey },
        select: {
          id: true,
          supplierInvoiceId: true,
          creditNoteNumber: true,
          amount: true,
          issuedAt: true,
          reason: true,
        },
      });
      if (priorCredit) {
        if (priorCredit.supplierInvoiceId !== invoice.id) {
          throw new Error("SUPPLIER_CREDIT_IDEMPOTENCY_CONFLICT");
        }
        if (!supplierCreditNoteRequestMatches(
          {
            creditNoteNumber: priorCredit.creditNoteNumber,
            amount: priorCredit.amount.toString(),
            issueDate: priorCredit.issuedAt.toISOString().slice(0, 10),
            reason: priorCredit.reason,
          },
          parsed.data,
        )) {
          throw new Error("SUPPLIER_CREDIT_IDEMPOTENCY_PAYLOAD_CONFLICT");
        }
        return false;
      }

      const credit = await transaction.supplierCreditNote.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          supplierInvoiceId: invoice.id,
          createdById: membership.userId,
          creditNoteNumber: parsed.data.creditNoteNumber,
          amount: new Prisma.Decimal(parsed.data.amount),
          issuedAt: new Date(`${issueDateKey}T00:00:00.000Z`),
          reason: parsed.data.reason,
          idempotencyKey: parsed.data.idempotencyKey,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "supplier_invoice.credit_note_recorded",
          entityType: "SupplierCreditNote",
          entityId: credit.id,
          details: {
            invoiceNumber: invoice.invoiceNumber,
            supplierId: invoice.supplierId,
            creditNoteNumber: credit.creditNoteNumber,
            amount: credit.amount.toString(),
            issueDate: issueDateKey,
            reason: credit.reason,
          },
        },
      });
      return true;
    });
    if (recorded) revalidatePath("/purchasing");
    return {
      status: "success",
      message: recorded ? "Supplier credit note recorded." : "This credit-note request was already recorded.",
    };
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_INVOICE_NOT_FOUND") {
      return { status: "error", message: "That supplier invoice is unavailable. Refresh and try again." };
    }
    if (error instanceof Error && error.message === "SUPPLIER_CREDIT_IDEMPOTENCY_CONFLICT") {
      return { status: "error", message: "This credit-note request key was already used for a different invoice." };
    }
    if (error instanceof Error && error.message === "SUPPLIER_CREDIT_IDEMPOTENCY_PAYLOAD_CONFLICT") {
      return { status: "error", message: "This credit-note request key was already used with different credit details." };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "That credit-note request or number is already recorded." };
    }
    console.error("Supplier credit note recording failed.", error);
    return { status: "error", message: "The supplier credit note could not be recorded. Please try again." };
  }
}

export async function recordSupplierFollowUp(
  _previousState: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const parsed = supplierFollowUpSchema.safeParse({
    purchaseOrderId: formData.get("purchaseOrderId"),
    method: formData.get("method"),
    summary: formData.get("summary"),
    followUpAt: formData.get("followUpAt") || "",
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the supplier follow-up details." };
  }

  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "purchasing", operation: "change" });
  if (!canManageSuppliers(membership.role)) {
    return { status: "error", message: "Your role cannot record supplier follow-ups." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "PurchaseOrder"
        WHERE "id" = ${parsed.data.purchaseOrderId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
        FOR UPDATE
      `;
      const order = await transaction.purchaseOrder.findFirst({
        where: {
          id: parsed.data.purchaseOrderId,
          organizationId: organization.id,
          storeId: store.id,
          status: { in: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        },
        select: { id: true, number: true, supplierId: true, expectedAt: true, nextFollowUpAt: true },
      });
      const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
      const businessDateStart = new Date(`${businessDate}T00:00:00.000Z`);
      const nextBusinessDateStart = new Date(businessDateStart);
      nextBusinessDateStart.setUTCDate(nextBusinessDateStart.getUTCDate() + 1);
      const expectedDateOverdue = order?.expectedAt
        ? order.expectedAt.toISOString().slice(0, 10) < businessDate
        : false;
      const scheduledFollowUpDue = order?.nextFollowUpAt
        ? order.nextFollowUpAt < nextBusinessDateStart
        : false;
      if (!order || (!expectedDateOverdue && !scheduledFollowUpDue)) {
        throw new Error("SUPPLIER_FOLLOWUP_ORDER_NOT_ELIGIBLE");
      }
      if (parsed.data.followUpAt && parsed.data.followUpAt < businessDate) {
        throw new Error("SUPPLIER_FOLLOWUP_DATE_IN_PAST");
      }

      const followUp = await transaction.supplierFollowUp.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          purchaseOrderId: order.id,
          createdById: membership.userId,
          method: parsed.data.method,
          summary: parsed.data.summary,
          followUpAt: parsed.data.followUpAt
            ? new Date(`${parsed.data.followUpAt}T00:00:00.000Z`)
            : null,
        },
      });
      await transaction.purchaseOrder.update({
        where: { id: order.id },
        data: {
          nextFollowUpAt: followUp.followUpAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "supplier.followup_recorded",
          entityType: "PurchaseOrder",
          entityId: order.id,
          details: {
            purchaseOrderNumber: order.number,
            supplierId: order.supplierId,
            followUpId: followUp.id,
            method: followUp.method,
            followUpAt: followUp.followUpAt?.toISOString() ?? null,
          },
        },
      });
    });
    revalidatePath("/purchasing");
    return { status: "success", message: "Supplier follow-up recorded." };
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_FOLLOWUP_ORDER_NOT_ELIGIBLE") {
      return { status: "error", message: "Follow-ups can only be recorded for overdue open orders or orders with a due follow-up." };
    }
    if (error instanceof Error && error.message === "SUPPLIER_FOLLOWUP_DATE_IN_PAST") {
      return { status: "error", message: "Choose today or a future date for the next follow-up." };
    }
    console.error("Supplier follow-up recording failed.", error);
    return { status: "error", message: "The supplier follow-up could not be saved. Please try again." };
  }
}

export async function createPurchaseOrder(
  _previousState: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const parsed = purchaseOrderInputSchema.safeParse({
    supplierId: formData.get("supplierId"),
    expectedAt: formData.get("expectedAt") || "",
    notes: formData.get("notes") || undefined,
    lines: parseJsonField(formData.get("lines")),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the purchase order details." };
  }

  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "purchasing", operation: "change" });
  if (!canManageSuppliers(membership.role)) {
    return { status: "error", message: "Your role cannot create purchase orders." };
  }

  try {
    const { supplierId, expectedAt, notes, lines } = parsed.data;
    await prisma.$transaction(async (transaction) => {
      const supplier = await transaction.supplier.findFirst({
        where: { id: supplierId, organizationId: organization.id, archivedAt: null },
        select: { id: true },
      });
      if (!supplier) throw new Error("SUPPLIER_NOT_AVAILABLE");

      const variants = await transaction.productVariant.findMany({
        where: {
          organizationId: organization.id,
          id: { in: lines.map((line) => line.variantId) },
          product: { archivedAt: null },
        },
        include: { product: { select: { name: true } } },
      });
      if (variants.length !== lines.length) throw new Error("PRODUCT_NOT_AVAILABLE");
      const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
      const subtotal = lines.reduce(
        (sum, line) => sum.plus(new Prisma.Decimal(line.unitCost).mul(line.quantity)),
        new Prisma.Decimal(0),
      );

      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      const latestOrder = await transaction.purchaseOrder.aggregate({
        where: { organizationId: organization.id },
        _max: { number: true },
      });
      const number = (latestOrder._max.number ?? 0) + 1;

      const order = await transaction.purchaseOrder.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          supplierId,
          number,
          subtotal,
          expectedAt: expectedAt ? new Date(`${expectedAt}T00:00:00.000Z`) : null,
          notes: notes || null,
          items: {
            create: lines.map((line) => {
              const variant = variantsById.get(line.variantId);
              if (!variant) throw new Error("PRODUCT_NOT_AVAILABLE");
              return {
                variantId: variant.id,
                productName: variant.product.name,
                sku: variant.sku,
                orderedQuantity: line.quantity,
                unitCost: new Prisma.Decimal(line.unitCost),
                lineTotal: new Prisma.Decimal(line.unitCost).mul(line.quantity),
              };
            }),
          },
        },
      });

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "purchase_order.created",
          entityType: "PurchaseOrder",
          entityId: order.id,
          details: { number, supplierId, lineCount: lines.length, subtotal: subtotal.toString() },
        },
      });
    });

    revalidatePath("/purchasing");
    return { status: "success", message: "Purchase order created." };
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_NOT_AVAILABLE") {
      return { status: "error", message: "Select an active supplier and try again." };
    }
    if (error instanceof Error && error.message === "PRODUCT_NOT_AVAILABLE") {
      return { status: "error", message: "One or more products are no longer active. Refresh and try again." };
    }
    console.error("Purchase order creation failed.", error);
    return { status: "error", message: "The purchase order could not be saved. Please try again." };
  }
}

export async function receivePurchaseOrder(
  _previousState: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const parsed = purchaseOrderReceiveSchema.safeParse({
    purchaseOrderId: formData.get("purchaseOrderId"),
    lines: parseJsonField(formData.get("lines")),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the quantities to receive." };
  }

  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "purchasing", operation: "change" });
  if (!canManageSuppliers(membership.role)) {
    return { status: "error", message: "Your role cannot receive purchase orders." };
  }

  const { purchaseOrderId, lines } = parsed.data;
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "PurchaseOrder"
        WHERE "id" = ${purchaseOrderId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
        FOR UPDATE
      `;
      const order = await transaction.purchaseOrder.findFirst({
        where: {
          id: purchaseOrderId,
          organizationId: organization.id,
          storeId: store.id,
          status: { in: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        },
        include: { items: true },
      });
      if (!order) throw new Error("PURCHASE_ORDER_NOT_RECEIVABLE");

      const orderItemsById = new Map(order.items.map((item) => [item.id, item]));
      for (const line of lines) {
        if (line.quantity === 0) continue;
        const orderItem = orderItemsById.get(line.itemId);
        if (!orderItem) throw new Error("PURCHASE_ORDER_LINE_NOT_FOUND");
        const updatedLine = await transaction.purchaseOrderItem.updateMany({
          where: {
            id: orderItem.id,
            purchaseOrderId: order.id,
            receivedQuantity: { lte: orderItem.orderedQuantity - line.quantity },
          },
          data: { receivedQuantity: { increment: line.quantity } },
        });
        if (updatedLine.count !== 1) throw new Error("RECEIPT_EXCEEDS_ORDER");

        await transaction.inventoryLevel.upsert({
          where: { storeId_variantId: { storeId: store.id, variantId: orderItem.variantId } },
          create: {
            organizationId: organization.id,
            storeId: store.id,
            variantId: orderItem.variantId,
            quantity: line.quantity,
          },
          update: { quantity: { increment: line.quantity } },
        });

        await transaction.inventoryMovement.create({
          data: {
            organizationId: organization.id,
            storeId: store.id,
            variantId: orderItem.variantId,
            createdById: membership.userId,
            type: InventoryMovementType.RECEIPT,
            quantityDelta: line.quantity,
            reason: `Purchase order #${order.number} received`,
            reference: order.id,
          },
        });
      }

      const refreshedLines = await transaction.purchaseOrderItem.findMany({
        where: { purchaseOrderId: order.id },
        select: { orderedQuantity: true, receivedQuantity: true },
      });
      const complete = refreshedLines.every((item) => item.receivedQuantity === item.orderedQuantity);
      await transaction.purchaseOrder.update({
        where: { id: order.id },
        data: { status: complete ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED },
      });

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: complete ? "purchase_order.received" : "purchase_order.partially_received",
          entityType: "PurchaseOrder",
          entityId: order.id,
          details: { number: order.number, receivedLines: lines.filter((line) => line.quantity > 0).length },
        },
      });
    });

    revalidatePath("/purchasing");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { status: "success", message: "Received quantities were added to inventory." };
  } catch (error) {
    if (error instanceof Error && error.message === "PURCHASE_ORDER_NOT_RECEIVABLE") {
      return { status: "error", message: "This purchase order is no longer open for receiving." };
    }
    if (error instanceof Error && error.message === "PURCHASE_ORDER_LINE_NOT_FOUND") {
      return { status: "error", message: "A purchase order line is invalid. Refresh and try again." };
    }
    if (error instanceof Error && error.message === "RECEIPT_EXCEEDS_ORDER") {
      return { status: "error", message: "A received quantity cannot exceed the outstanding order quantity." };
    }
    console.error("Purchase order receipt failed.", error);
    return { status: "error", message: "The purchase order could not be received. Please try again." };
  }
}

export async function returnSupplierGoods(
  _previousState: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const parsed = supplierReturnSchema.safeParse({
    purchaseOrderId: formData.get("purchaseOrderId"),
    itemId: formData.get("itemId"),
    quantity: formData.get("quantity"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the supplier return details." };
  }

  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "purchasing", operation: "change" });
  if (!canManageSuppliers(membership.role)) {
    return { status: "error", message: "Your role cannot return stock to suppliers." };
  }
  const { purchaseOrderId, itemId, quantity, reason } = parsed.data;

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "PurchaseOrder"
        WHERE "id" = ${purchaseOrderId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
        FOR UPDATE
      `;
      const order = await transaction.purchaseOrder.findFirst({
        where: { id: purchaseOrderId, organizationId: organization.id, storeId: store.id },
        select: {
          id: true,
          number: true,
          items: {
            where: { id: itemId },
            select: { id: true, variantId: true, receivedQuantity: true, unitCost: true },
          },
        },
      });
      const item = order?.items[0];
      if (!order || !item) throw new Error("SUPPLIER_RETURN_LINE_NOT_FOUND");
      if (item.receivedQuantity < 1) throw new Error("SUPPLIER_RETURN_NOT_RECEIVED");

      const previouslyReturned = await transaction.supplierReturnItem.aggregate({
        where: { purchaseOrderItemId: item.id },
        _sum: { quantity: true },
      });
      const remainingReceived = item.receivedQuantity - (previouslyReturned._sum.quantity ?? 0);
      if (quantity > remainingReceived) throw new Error("SUPPLIER_RETURN_EXCEEDS_RECEIVED");

      await transaction.$queryRaw`
        SELECT "id" FROM "InventoryLevel"
        WHERE "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
          AND "variantId" = ${item.variantId}
        FOR UPDATE
      `;
      const level = await transaction.inventoryLevel.findFirst({
        where: { organizationId: organization.id, storeId: store.id, variantId: item.variantId },
      });
      if (!level) throw new Error("SUPPLIER_RETURN_STOCK_NOT_FOUND");
      const updated = await transaction.inventoryLevel.updateMany({
        where: {
          id: level.id,
          organizationId: organization.id,
          storeId: store.id,
          quantity: { gte: level.reserved + quantity },
          reserved: level.reserved,
        },
        data: { quantity: { decrement: quantity } },
      });
      if (updated.count !== 1) throw new Error("SUPPLIER_RETURN_INSUFFICIENT_AVAILABLE");

      const supplierReturn = await transaction.supplierReturn.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          purchaseOrderId: order.id,
          createdById: membership.userId,
          reason,
          items: {
            create: {
              purchaseOrderItemId: item.id,
              quantity,
              unitCost: item.unitCost,
            },
          },
        },
      });
      await transaction.inventoryMovement.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          variantId: item.variantId,
          createdById: membership.userId,
          type: InventoryMovementType.SUPPLIER_RETURN,
          quantityDelta: -quantity,
          reason: `Return to supplier for purchase order #${order.number}: ${reason}`,
          reference: supplierReturn.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "supplier_return.created",
          entityType: "SupplierReturn",
          entityId: supplierReturn.id,
          details: {
            purchaseOrderId: order.id,
            purchaseOrderNumber: order.number,
            purchaseOrderItemId: item.id,
            quantity,
            unitCost: item.unitCost.toString(),
            reason,
          },
        },
      });
    });

    revalidatePath("/purchasing");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { status: "success", message: "Supplier return recorded and stock updated." };
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_RETURN_LINE_NOT_FOUND") {
      return { status: "error", message: "That purchase-order line is unavailable. Refresh and try again." };
    }
    if (error instanceof Error && error.message === "SUPPLIER_RETURN_NOT_RECEIVED") {
      return { status: "error", message: "Only quantities already received can be returned to the supplier." };
    }
    if (error instanceof Error && error.message === "SUPPLIER_RETURN_EXCEEDS_RECEIVED") {
      return { status: "error", message: "The return quantity exceeds the received quantity that has not already been returned." };
    }
    if (error instanceof Error && error.message === "SUPPLIER_RETURN_STOCK_NOT_FOUND") {
      return { status: "error", message: "No active-store inventory record exists for this received item." };
    }
    if (error instanceof Error && error.message === "SUPPLIER_RETURN_INSUFFICIENT_AVAILABLE") {
      return { status: "error", message: "The return cannot reduce stock below the quantity reserved for orders." };
    }
    console.error("Supplier return failed.", error);
    return { status: "error", message: "The supplier return could not be recorded. Please try again." };
  }
}

export async function cancelPurchaseOrder(
  _previousState: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const parsed = purchaseOrderCancelSchema.safeParse({
    purchaseOrderId: formData.get("purchaseOrderId"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Select a valid purchase order." };
  }

  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "purchasing", operation: "change" });
  if (!canManageSuppliers(membership.role)) {
    return { status: "error", message: "Your role cannot cancel purchase orders." };
  }

  const { purchaseOrderId } = parsed.data;
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "PurchaseOrder"
        WHERE "id" = ${purchaseOrderId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
        FOR UPDATE
      `;
      const order = await transaction.purchaseOrder.findFirst({
        where: {
          id: purchaseOrderId,
          organizationId: organization.id,
          storeId: store.id,
          status: PurchaseOrderStatus.ORDERED,
        },
        include: { items: { select: { receivedQuantity: true } } },
      });
      if (!order || order.items.some((item) => item.receivedQuantity !== 0)) {
        throw new Error("PURCHASE_ORDER_NOT_CANCELLABLE");
      }

      const updatedOrder = await transaction.purchaseOrder.updateMany({
        where: {
          id: order.id,
          organizationId: organization.id,
          storeId: store.id,
          status: PurchaseOrderStatus.ORDERED,
        },
        data: { status: PurchaseOrderStatus.CANCELLED },
      });
      if (updatedOrder.count !== 1) throw new Error("PURCHASE_ORDER_NOT_CANCELLABLE");

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "purchase_order.cancelled",
          entityType: "PurchaseOrder",
          entityId: order.id,
          details: { number: order.number },
        },
      });
    });

    revalidatePath("/purchasing");
    return { status: "success", message: "Purchase order cancelled." };
  } catch (error) {
    if (error instanceof Error && error.message === "PURCHASE_ORDER_NOT_CANCELLABLE") {
      return { status: "error", message: "Only purchase orders with no received items can be cancelled." };
    }
    console.error("Purchase order cancellation failed.", error);
    return { status: "error", message: "The purchase order could not be cancelled. Please try again." };
  }
}
