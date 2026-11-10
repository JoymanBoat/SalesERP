"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { canManageCustomers } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { customerInputSchema, customerStatusSchema, customerUpdateSchema } from "@/lib/validation";

export type CustomerActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

export async function createCustomer(
  _previousState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const parsed = customerInputSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the customer details." };
  }

  const { organization, membership } = await getWorkspace({ feature: "customers", operation: "change" });
  if (!canManageCustomers(membership.role)) {
    return { status: "error", message: "Your role cannot create customers." };
  }

  const input = parsed.data;
  try {
    const customer = await prisma.$transaction(async (transaction) => {
      const created = await transaction.customer.create({
        data: {
          organizationId: organization.id,
          firstName: input.firstName,
          lastName: input.lastName || null,
          email: input.email || null,
          phone: input.phone || null,
          notes: input.notes || null,
        },
      });

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "customer.created",
          entityType: "Customer",
          entityId: created.id,
        },
      });

      return created;
    });

    revalidatePath("/customers");
    return { status: "success", message: `${customer.firstName} was added to your customers.` };
  } catch (error) {
    console.error("Customer creation failed.", error);
    return { status: "error", message: "The customer could not be saved. Please try again." };
  }
}

export async function updateCustomer(
  _previousState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const parsed = customerUpdateSchema.safeParse({
    customerId: formData.get("customerId"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the customer details." };
  }

  const { organization, membership } = await getWorkspace({ feature: "customers", operation: "change" });
  if (!canManageCustomers(membership.role)) {
    return { status: "error", message: "Your role cannot update customers." };
  }

  const { customerId, ...input } = parsed.data;
  try {
    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.customer.updateMany({
        where: { id: customerId, organizationId: organization.id, archivedAt: null },
        data: {
          firstName: input.firstName,
          lastName: input.lastName || null,
          email: input.email || null,
          phone: input.phone || null,
          notes: input.notes || null,
        },
      });
      if (result.count !== 1) throw new Error("CUSTOMER_NOT_AVAILABLE");

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "customer.updated",
          entityType: "Customer",
          entityId: customerId,
        },
      });
      return transaction.customer.findFirstOrThrow({
        where: { id: customerId, organizationId: organization.id },
        select: { firstName: true },
      });
    });

    revalidatePath("/customers");
    return { status: "success", message: `${updated.firstName}'s details were updated.` };
  } catch (error) {
    if (error instanceof Error && error.message === "CUSTOMER_NOT_AVAILABLE") {
      return { status: "error", message: "That customer is no longer active. Refresh the directory and try again." };
    }
    console.error("Customer update failed.", error);
    return { status: "error", message: "The customer could not be updated. Please try again." };
  }
}

export async function setCustomerActive(
  _previousState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const parsed = customerStatusSchema.safeParse({
    customerId: formData.get("customerId"),
    active: formData.get("active"),
  });

  if (!parsed.success) {
    return { status: "error", message: "That customer status request is invalid." };
  }

  const { organization, membership } = await getWorkspace({ feature: "customers", operation: "change" });
  if (!canManageCustomers(membership.role)) {
    return { status: "error", message: "Your role cannot change customer status." };
  }

  const { customerId, active } = parsed.data;
  try {
    await prisma.$transaction(async (transaction) => {
      const result = await transaction.customer.updateMany({
        where: {
          id: customerId,
          organizationId: organization.id,
          archivedAt: active ? { not: null } : null,
        },
        data: { archivedAt: active ? null : new Date() },
      });
      if (result.count !== 1) throw new Error("CUSTOMER_STATUS_UNCHANGED");

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: active ? "customer.reactivated" : "customer.deactivated",
          entityType: "Customer",
          entityId: customerId,
        },
      });
      return transaction.customer.findFirstOrThrow({
        where: { id: customerId, organizationId: organization.id },
        select: { firstName: true },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CUSTOMER_STATUS_UNCHANGED") {
      return { status: "error", message: "That customer status has changed. Refresh the directory and try again." };
    }
    console.error("Customer status update failed.", error);
    return { status: "error", message: "The customer status could not be updated. Please try again." };
  }

  revalidatePath("/customers");
  redirect(active ? "/customers?notice=reactivated" : "/customers?status=inactive&notice=deactivated");
}
