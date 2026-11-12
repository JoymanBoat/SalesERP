"use server";

import { MembershipRole, Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { canManageStores } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getMutationWorkspace } from "@/lib/workspace";
import {
  posRegisterInputSchema,
  posRegisterSelectionSchema,
  posRegisterStatusSchema,
  posRegisterUpdateSchema,
} from "@/lib/validation";

export type PosRegisterActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

async function assertCurrentOwner(transaction: Prisma.TransactionClient, organizationId: string, userId: string) {
  const owner = await transaction.organizationMembership.findFirst({
    where: { organizationId, userId, role: MembershipRole.OWNER },
    select: { id: true },
  });
  if (!owner) throw new Error("REGISTER_ACTOR_NOT_OWNER");
}

function revalidateRegisterPages() {
  revalidatePath("/registers");
  revalidatePath("/pos");
  revalidatePath("/register-shifts");
  revalidatePath("/team");
}

export async function switchActiveRegister(formData: FormData): Promise<void> {
  const parsed = posRegisterSelectionSchema.safeParse({ registerId: formData.get("registerId") });
  if (!parsed.success) redirect("/pos?registerError=invalid");

  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "pos", operation: "change" });
  const register = await prisma.posRegister.findFirst({
    where: {
      id: parsed.data.registerId,
      organizationId: organization.id,
      storeId: store.id,
      active: true,
      ...(membership.role === MembershipRole.OWNER
        ? {}
        : { assignments: { some: { membershipId: membership.id } } }),
    },
    select: { id: true },
  });
  if (!register) redirect("/pos?registerError=unavailable");

  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
  cookieStore.set("saleserp-organization-id", organization.id, cookieOptions);
  cookieStore.set("saleserp-register-id", register.id, cookieOptions);
  redirect("/pos");
}

export async function createPosRegister(
  _previousState: PosRegisterActionState,
  formData: FormData,
): Promise<PosRegisterActionState> {
  const parsed = posRegisterInputSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the POS register details." };
  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "pos", operation: "change" });
  if (!canManageStores(membership.role)) return { status: "error", message: "Only an organization owner can manage POS registers." };

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      await assertCurrentOwner(transaction, organization.id, membership.userId);
      const register = await transaction.posRegister.create({
        data: { organizationId: organization.id, storeId: store.id, ...parsed.data },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "pos_register.created",
          entityType: "PosRegister",
          entityId: register.id,
          details: { storeId: store.id, name: register.name, code: register.code },
        },
      });
    });
    revalidateRegisterPages();
    return { status: "success", message: "POS register created." };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "That register name or code is already used at this store." };
    }
    if (error instanceof Error && error.message === "REGISTER_ACTOR_NOT_OWNER") {
      return { status: "error", message: "Only a current organization owner can manage POS registers." };
    }
    console.error("POS register creation failed.", error);
    return { status: "error", message: "The POS register could not be created. Please try again." };
  }
}

export async function updatePosRegister(
  _previousState: PosRegisterActionState,
  formData: FormData,
): Promise<PosRegisterActionState> {
  const parsed = posRegisterUpdateSchema.safeParse({
    registerId: formData.get("registerId"),
    name: formData.get("name"),
    code: formData.get("code"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the POS register details." };
  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "pos", operation: "change" });
  if (!canManageStores(membership.role)) return { status: "error", message: "Only an organization owner can manage POS registers." };

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      await assertCurrentOwner(transaction, organization.id, membership.userId);
      const updated = await transaction.posRegister.updateMany({
        where: { id: parsed.data.registerId, organizationId: organization.id, storeId: store.id },
        data: { name: parsed.data.name, code: parsed.data.code },
      });
      if (updated.count !== 1) throw new Error("REGISTER_NOT_FOUND");
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "pos_register.updated",
          entityType: "PosRegister",
          entityId: parsed.data.registerId,
          details: { storeId: store.id, name: parsed.data.name, code: parsed.data.code },
        },
      });
    });
    revalidateRegisterPages();
    return { status: "success", message: "POS register updated." };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "That register name or code is already used at this store." };
    }
    if (error instanceof Error && error.message === "REGISTER_NOT_FOUND") return { status: "error", message: "That POS register is no longer available." };
    if (error instanceof Error && error.message === "REGISTER_ACTOR_NOT_OWNER") return { status: "error", message: "Only a current organization owner can manage POS registers." };
    console.error("POS register update failed.", error);
    return { status: "error", message: "The POS register could not be updated. Please try again." };
  }
}

export async function setPosRegisterActive(
  _previousState: PosRegisterActionState,
  formData: FormData,
): Promise<PosRegisterActionState> {
  const parsed = posRegisterStatusSchema.safeParse({
    registerId: formData.get("registerId"),
    active: formData.get("active"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the POS register status." };
  const { organization, membership, store } = await getMutationWorkspace(formData, { feature: "pos", operation: "change" });
  if (!canManageStores(membership.role)) return { status: "error", message: "Only an organization owner can manage POS registers." };

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      await assertCurrentOwner(transaction, organization.id, membership.userId);
      await transaction.$queryRaw`
        SELECT "id" FROM "PosRegister"
        WHERE "id" = ${parsed.data.registerId}
          AND "storeId" = ${store.id}
          AND "organizationId" = ${organization.id}
        FOR UPDATE
      `;
      const register = await transaction.posRegister.findFirst({
        where: { id: parsed.data.registerId, organizationId: organization.id, storeId: store.id },
        select: { id: true, active: true, name: true, code: true },
      });
      if (!register) throw new Error("REGISTER_NOT_FOUND");
      if (!parsed.data.active && register.active) {
        const activeCount = await transaction.posRegister.count({
          where: { organizationId: organization.id, storeId: store.id, active: true },
        });
        if (activeCount <= 1) throw new Error("REGISTER_LAST_ACTIVE");
        const openShift = await transaction.registerShift.findFirst({
          where: { organizationId: organization.id, storeId: store.id, registerId: register.id, closedAt: null },
          select: { id: true },
        });
        if (openShift) throw new Error("REGISTER_SHIFT_OPEN");
      }
      await transaction.posRegister.update({ where: { id: register.id }, data: { active: parsed.data.active } });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: parsed.data.active ? "pos_register.activated" : "pos_register.deactivated",
          entityType: "PosRegister",
          entityId: register.id,
          details: { storeId: store.id, name: register.name, code: register.code },
        },
      });
    });
    revalidateRegisterPages();
    return { status: "success", message: parsed.data.active ? "POS register activated." : "POS register deactivated." };
  } catch (error) {
    if (error instanceof Error && error.message === "REGISTER_NOT_FOUND") return { status: "error", message: "That POS register is no longer available." };
    if (error instanceof Error && error.message === "REGISTER_LAST_ACTIVE") return { status: "error", message: "At least one POS register must remain active at this store." };
    if (error instanceof Error && error.message === "REGISTER_SHIFT_OPEN") return { status: "error", message: "Close this register's open shift before deactivating it." };
    if (error instanceof Error && error.message === "REGISTER_ACTOR_NOT_OWNER") return { status: "error", message: "Only a current organization owner can manage POS registers." };
    console.error("POS register status update failed.", error);
    return { status: "error", message: "The POS register status could not be updated. Please try again." };
  }
}
