"use server";

import { MembershipRole, Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { canManageStores } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertSubscriptionCapacity, SubscriptionCapacityError, subscriptionCapacityMessage } from "@/lib/subscription-access";
import { getMutationWorkspace } from "@/lib/workspace";
import {
  storeCreateSchema,
  storeSelectionSchema,
  storeStatusSchema,
  storeUpdateSchema,
} from "@/lib/validation";

export type StoreActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

async function assertCurrentOwner(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
) {
  const owner = await transaction.organizationMembership.findFirst({
    where: { organizationId, userId, role: MembershipRole.OWNER },
    select: { id: true },
  });
  if (!owner) throw new Error("STORE_ACTOR_NOT_OWNER");
}

function isDuplicateStoreCode(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function switchActiveStore(formData: FormData): Promise<void> {
  const parsed = storeSelectionSchema.safeParse({ storeId: formData.get("storeId") });
  if (!parsed.success) redirect("/dashboard?storeError=invalid");

  const { organization, membership } = await getMutationWorkspace(formData, { operation: "view" });
  const selectedStore = await prisma.store.findFirst({
    where: {
      id: parsed.data.storeId,
      organizationId: organization.id,
      active: true,
      ...(membership.role === MembershipRole.OWNER
        ? {}
        : { employeeAssignments: { some: { membershipId: membership.id } } }),
    },
    select: { id: true },
  });
  if (!selectedStore) redirect("/dashboard?storeError=unavailable");

  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
  cookieStore.set("saleserp-organization-id", organization.id, cookieOptions);
  cookieStore.set("saleserp-store-id", selectedStore.id, cookieOptions);
  redirect("/dashboard");
}

export async function createStore(
  _previousState: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  const parsed = storeCreateSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    address: formData.get("address") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the store details." };
  }

  const { organization, membership } = await getMutationWorkspace(formData, { operation: "change" });
  if (!canManageStores(membership.role)) {
    return { status: "error", message: "Only an organization owner can manage stores." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      await assertCurrentOwner(transaction, organization.id, membership.userId);
      await assertSubscriptionCapacity(transaction, organization.id, "stores");

      const store = await transaction.store.create({
        data: {
          organizationId: organization.id,
          name: parsed.data.name,
          code: parsed.data.code,
          address: parsed.data.address,
        },
      });
      await transaction.posRegister.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          name: "Main register",
          code: "MAIN",
        },
      });
      const variants = await transaction.productVariant.findMany({
        where: { organizationId: organization.id, trackInventory: true },
        select: { id: true },
      });
      if (variants.length > 0) {
        await transaction.inventoryLevel.createMany({
          data: variants.map(({ id }) => ({
            organizationId: organization.id,
            storeId: store.id,
            variantId: id,
            quantity: 0,
          })),
        });
      }
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "store.created",
          entityType: "Store",
          entityId: store.id,
          details: { name: store.name, code: store.code, address: store.address },
        },
      });
    });

    revalidateStorePages();
    return { status: "success", message: "Store created with a main POS register. Tracked products start at zero stock." };
  } catch (error) {
    if (error instanceof SubscriptionCapacityError) return { status: "error", message: subscriptionCapacityMessage(error) };
    if (isDuplicateStoreCode(error)) {
      return { status: "error", message: "That store code is already in use in this organization." };
    }
    if (error instanceof Error && error.message === "STORE_ACTOR_NOT_OWNER") {
      return { status: "error", message: "Only a current organization owner can manage stores." };
    }
    console.error("Store creation failed.", error);
    return { status: "error", message: "The store could not be created. Please try again." };
  }
}

export async function updateStore(
  _previousState: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  const parsed = storeUpdateSchema.safeParse({
    storeId: formData.get("storeId"),
    name: formData.get("name"),
    code: formData.get("code"),
    address: formData.get("address") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the store details." };
  }

  const { organization, membership } = await getMutationWorkspace(formData, { operation: "change" });
  if (!canManageStores(membership.role)) {
    return { status: "error", message: "Only an organization owner can manage stores." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      await assertCurrentOwner(transaction, organization.id, membership.userId);
      const updated = await transaction.store.updateMany({
        where: { id: parsed.data.storeId, organizationId: organization.id },
        data: {
          name: parsed.data.name,
          code: parsed.data.code,
          address: parsed.data.address,
        },
      });
      if (updated.count !== 1) throw new Error("STORE_NOT_FOUND");
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "store.updated",
          entityType: "Store",
          entityId: parsed.data.storeId,
          details: { name: parsed.data.name, code: parsed.data.code, address: parsed.data.address },
        },
      });
    });

    revalidateStorePages();
    return { status: "success", message: "Store details updated." };
  } catch (error) {
    if (error instanceof Error && error.message === "STORE_NOT_FOUND") {
      return { status: "error", message: "That store is no longer available in this organization." };
    }
    if (error instanceof Error && error.message === "STORE_ACTOR_NOT_OWNER") {
      return { status: "error", message: "Only a current organization owner can manage stores." };
    }
    if (isDuplicateStoreCode(error)) {
      return { status: "error", message: "That store code is already in use in this organization." };
    }
    console.error("Store update failed.", error);
    return { status: "error", message: "The store could not be updated. Please try again." };
  }
}

export async function setStoreActive(
  _previousState: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  const parsed = storeStatusSchema.safeParse({
    storeId: formData.get("storeId"),
    active: formData.get("active"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Select a valid store status." };
  }

  const { organization, membership } = await getMutationWorkspace(formData, { operation: "change" });
  if (!canManageStores(membership.role)) {
    return { status: "error", message: "Only an organization owner can manage stores." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      await assertCurrentOwner(transaction, organization.id, membership.userId);
      await transaction.$queryRaw`
        SELECT "id" FROM "Store"
        WHERE "id" = ${parsed.data.storeId} AND "organizationId" = ${organization.id}
        FOR UPDATE
      `;
      const store = await transaction.store.findFirst({
        where: { id: parsed.data.storeId, organizationId: organization.id },
        select: { id: true, active: true, name: true },
      });
      if (!store) throw new Error("STORE_NOT_FOUND");
      if (store.active === parsed.data.active) throw new Error("STORE_STATUS_UNCHANGED");

      if (parsed.data.active) await assertSubscriptionCapacity(transaction, organization.id, "stores");
      if (!parsed.data.active) {
        const activeCount = await transaction.store.count({
          where: { organizationId: organization.id, active: true },
        });
        if (activeCount <= 1) throw new Error("STORE_LAST_ACTIVE");
        const openShift = await transaction.registerShift.findFirst({
          where: { organizationId: organization.id, storeId: store.id, closedAt: null },
          select: { id: true },
        });
        if (openShift) throw new Error("STORE_SHIFT_OPEN");

        const affectedEmployees = await transaction.organizationMembership.findMany({
          where: {
            organizationId: organization.id,
            role: { not: MembershipRole.OWNER },
            storeAssignments: { some: { storeId: store.id } },
          },
          select: {
            id: true,
            storeAssignments: {
              where: {
                storeId: { not: store.id },
                store: { active: true },
              },
              select: { storeId: true },
              take: 1,
            },
          },
        });
        if (affectedEmployees.some((employee) => employee.storeAssignments.length === 0)) {
          throw new Error("STORE_EMPLOYEE_ACCESS");
        }
      }

      await transaction.store.update({
        where: { id: store.id },
        data: { active: parsed.data.active },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: parsed.data.active ? "store.activated" : "store.deactivated",
          entityType: "Store",
          entityId: store.id,
          details: { name: store.name },
        },
      });
    });

    revalidateStorePages();
    return {
      status: "success",
      message: parsed.data.active ? "Store reactivated." : "Store deactivated. Its history and stock records are retained.",
    };
  } catch (error) {
    if (error instanceof SubscriptionCapacityError) return { status: "error", message: subscriptionCapacityMessage(error) };
    if (error instanceof Error && error.message === "STORE_NOT_FOUND") {
      return { status: "error", message: "That store is no longer available in this organization." };
    }
    if (error instanceof Error && error.message === "STORE_STATUS_UNCHANGED") {
      return { status: "error", message: "That store already has the selected status." };
    }
    if (error instanceof Error && error.message === "STORE_LAST_ACTIVE") {
      return { status: "error", message: "At least one active store must remain in the organization." };
    }
    if (error instanceof Error && error.message === "STORE_SHIFT_OPEN") {
      return { status: "error", message: "Close the register shift before deactivating this store." };
    }
    if (error instanceof Error && error.message === "STORE_EMPLOYEE_ACCESS") {
      return { status: "error", message: "Reassign employees who only have access to this store before deactivating it." };
    }
    if (error instanceof Error && error.message === "STORE_ACTOR_NOT_OWNER") {
      return { status: "error", message: "Only a current organization owner can manage stores." };
    }
    console.error("Store status update failed.", error);
    return { status: "error", message: "The store status could not be changed. Please try again." };
  }
}

function revalidateStorePages() {
  for (const path of [
    "/stores",
    "/team",
    "/dashboard",
    "/inventory",
    "/pos",
    "/purchasing",
    "/reports",
    "/register-shifts",
    "/registers",
  ]) {
    revalidatePath(path);
  }
}
