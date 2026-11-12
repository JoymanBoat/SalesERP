"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { canManageSuppliers } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getMutationWorkspace } from "@/lib/workspace";
import { supplierInputSchema, supplierStatusSchema, supplierUpdateSchema } from "@/lib/validation";

export type SupplierActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

function parseSupplier(formData: FormData) {
  return supplierInputSchema.safeParse({
    businessName: formData.get("businessName"),
    contactName: formData.get("contactName") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    address: formData.get("address") || undefined,
    notes: formData.get("notes") || undefined,
  });
}

export async function createSupplier(
  _previousState: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  const parsed = parseSupplier(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the supplier details." };
  }

  const { organization, membership } = await getMutationWorkspace(formData, { feature: "suppliers", operation: "change" });
  if (!canManageSuppliers(membership.role)) {
    return { status: "error", message: "Your role cannot create suppliers." };
  }

  const input = parsed.data;
  try {
    const supplier = await prisma.$transaction(async (transaction) => {
      const created = await transaction.supplier.create({
        data: {
          organizationId: organization.id,
          businessName: input.businessName,
          contactName: input.contactName || null,
          email: input.email || null,
          phone: input.phone || null,
          address: input.address || null,
          notes: input.notes || null,
        },
      });

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "supplier.created",
          entityType: "Supplier",
          entityId: created.id,
        },
      });
      return created;
    });

    revalidatePath("/suppliers");
    return { status: "success", message: `${supplier.businessName} was added to your suppliers.` };
  } catch (error) {
    console.error("Supplier creation failed.", error);
    return { status: "error", message: "The supplier could not be saved. Please try again." };
  }
}

export async function updateSupplier(
  _previousState: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  const parsed = supplierUpdateSchema.safeParse({
    supplierId: formData.get("supplierId"),
    businessName: formData.get("businessName"),
    contactName: formData.get("contactName") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    address: formData.get("address") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the supplier details." };
  }

  const { organization, membership } = await getMutationWorkspace(formData, { feature: "suppliers", operation: "change" });
  if (!canManageSuppliers(membership.role)) {
    return { status: "error", message: "Your role cannot update suppliers." };
  }

  const { supplierId, ...input } = parsed.data;
  try {
    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.supplier.updateMany({
        where: { id: supplierId, organizationId: organization.id, archivedAt: null },
        data: {
          businessName: input.businessName,
          contactName: input.contactName || null,
          email: input.email || null,
          phone: input.phone || null,
          address: input.address || null,
          notes: input.notes || null,
        },
      });
      if (updated.count !== 1) throw new Error("SUPPLIER_NOT_AVAILABLE");

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "supplier.updated",
          entityType: "Supplier",
          entityId: supplierId,
        },
      });
    });

    revalidatePath("/suppliers");
    return { status: "success", message: `${input.businessName} was updated.` };
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_NOT_AVAILABLE") {
      return { status: "error", message: "That supplier is no longer active. Refresh the directory and try again." };
    }
    console.error("Supplier update failed.", error);
    return { status: "error", message: "The supplier could not be updated. Please try again." };
  }
}

export async function setSupplierActive(
  _previousState: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  const parsed = supplierStatusSchema.safeParse({
    supplierId: formData.get("supplierId"),
    active: formData.get("active"),
  });
  if (!parsed.success) {
    return { status: "error", message: "That supplier status request is invalid." };
  }

  const { organization, membership } = await getMutationWorkspace(formData, { feature: "suppliers", operation: "change" });
  if (!canManageSuppliers(membership.role)) {
    return { status: "error", message: "Your role cannot change supplier status." };
  }

  const { supplierId, active } = parsed.data;
  try {
    await prisma.$transaction(async (transaction) => {
      const result = await transaction.supplier.updateMany({
        where: {
          id: supplierId,
          organizationId: organization.id,
          archivedAt: active ? { not: null } : null,
        },
        data: { archivedAt: active ? null : new Date() },
      });
      if (result.count !== 1) throw new Error("SUPPLIER_STATUS_UNCHANGED");

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: active ? "supplier.reactivated" : "supplier.deactivated",
          entityType: "Supplier",
          entityId: supplierId,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_STATUS_UNCHANGED") {
      return { status: "error", message: "That supplier status has changed. Refresh the directory and try again." };
    }
    console.error("Supplier status update failed.", error);
    return { status: "error", message: "The supplier status could not be updated. Please try again." };
  }

  revalidatePath("/suppliers");
  redirect(active ? "/suppliers?notice=reactivated" : "/suppliers?status=inactive&notice=deactivated");
}
