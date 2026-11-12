"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { canOperateRegister } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getMutationWorkspace } from "@/lib/workspace";
import { registerShiftCloseSchema, registerShiftOpenSchema } from "@/lib/validation";

export type RegisterShiftActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

export async function openRegisterShift(
  _previousState: RegisterShiftActionState,
  formData: FormData,
): Promise<RegisterShiftActionState> {
  const parsed = registerShiftOpenSchema.safeParse({
    openingCash: formData.get("openingCash"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the opening float." };
  }

  const { organization, membership, store, register } = await getMutationWorkspace(formData, { feature: "pos", operation: "change" });
  if (!canOperateRegister(membership.role)) {
    return { status: "error", message: "Your role cannot open a register shift." };
  }
  if (!register) return { status: "error", message: "You do not have access to an active POS register at this store." };

  try {
    await prisma.$transaction(async (transaction) => {
      const activeStore = await transaction.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Store"
        WHERE "id" = ${store.id} AND "organizationId" = ${organization.id} AND "active" = true
        FOR UPDATE
      `;
      if (!activeStore.length) throw new Error("STORE_NOT_ACTIVE");
      await transaction.$queryRaw`
        SELECT "id" FROM "PosRegister"
        WHERE "id" = ${register.id} AND "storeId" = ${store.id}
          AND "organizationId" = ${organization.id} AND "active" = true
        FOR UPDATE
      `;
      const currentShift = await transaction.registerShift.findFirst({
        where: { organizationId: organization.id, storeId: store.id, registerId: register.id, closedAt: null },
        select: { id: true },
      });
      if (currentShift) throw new Error("REGISTER_SHIFT_ALREADY_OPEN");
      const currentRegister = await transaction.posRegister.findFirst({
        where: { id: register.id, organizationId: organization.id, storeId: store.id, active: true },
        select: { id: true },
      });
      if (!currentRegister) throw new Error("REGISTER_NOT_ACTIVE");

      const shift = await transaction.registerShift.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          registerId: register.id,
          openedById: membership.userId,
          openingCash: new Prisma.Decimal(parsed.data.openingCash),
          note: parsed.data.note || null,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "register_shift.opened",
          entityType: "RegisterShift",
          entityId: shift.id,
          details: { storeId: store.id, openingCash: shift.openingCash.toString(), note: shift.note },
        },
      });
    });

    revalidatePath("/register-shifts");
    revalidatePath("/dashboard");
    return { status: "success", message: "Register shift opened." };
  } catch (error) {
    if (error instanceof Error && error.message === "REGISTER_SHIFT_ALREADY_OPEN") {
      return { status: "error", message: "A shift is already open for this POS register." };
    }
    if (error instanceof Error && error.message === "REGISTER_NOT_ACTIVE") return { status: "error", message: "This POS register is no longer active." };
    if (error instanceof Error && error.message === "STORE_NOT_ACTIVE") return { status: "error", message: "This store is no longer active." };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "A register shift was opened by another operator. Refresh to continue." };
    }
    console.error("Register shift opening failed.", error);
    return { status: "error", message: "The register shift could not be opened. Please try again." };
  }
}

export async function closeRegisterShift(
  _previousState: RegisterShiftActionState,
  formData: FormData,
): Promise<RegisterShiftActionState> {
  const parsed = registerShiftCloseSchema.safeParse({
    shiftId: formData.get("shiftId"),
    closingCash: formData.get("closingCash"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the closing cash count." };
  }

  const { organization, membership, store, register } = await getMutationWorkspace(formData, { feature: "pos", operation: "change" });
  if (!canOperateRegister(membership.role)) {
    return { status: "error", message: "Your role cannot close a register shift." };
  }
  if (!register) return { status: "error", message: "You do not have access to an active POS register at this store." };

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "RegisterShift"
        WHERE "id" = ${parsed.data.shiftId}
          AND "organizationId" = ${organization.id}
          AND "storeId" = ${store.id}
          AND "registerId" = ${register.id}
        FOR UPDATE
      `;
      const shift = await transaction.registerShift.findFirst({
        where: {
          id: parsed.data.shiftId,
          organizationId: organization.id,
          storeId: store.id,
          registerId: register.id,
          closedAt: null,
        },
        select: { id: true, openingCash: true },
      });
      if (!shift) throw new Error("REGISTER_SHIFT_NOT_OPEN");
      const openDrafts = await transaction.order.count({
        where: {
          organizationId: organization.id,
          storeId: store.id,
          registerShiftId: shift.id,
          status: "DRAFT",
        },
      });
      if (openDrafts > 0) throw new Error("REGISTER_SHIFT_HAS_DRAFTS");

      const cashSales = await transaction.payment.aggregate({
        where: {
          method: "CASH",
          status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] },
          order: { organizationId: organization.id, storeId: store.id, registerShiftId: shift.id },
        },
        _sum: { amount: true },
      });
      const cashRefunds = await transaction.refund.aggregate({
        where: { organizationId: organization.id, storeId: store.id, registerShiftId: shift.id },
        _sum: { cashRefundAmount: true },
      });

      const closingCash = new Prisma.Decimal(parsed.data.closingCash);
      const sales = cashSales._sum.amount ?? new Prisma.Decimal(0);
      const refunds = cashRefunds._sum.cashRefundAmount ?? new Prisma.Decimal(0);
      const expectedCash = shift.openingCash.plus(sales).minus(refunds);
      const cashVariance = closingCash.minus(expectedCash);
      const closedAt = new Date();
      const update = await transaction.registerShift.updateMany({
        where: {
          id: shift.id,
          organizationId: organization.id,
          storeId: store.id,
          closedAt: null,
        },
        data: {
          closedById: membership.userId,
          closingCash,
          expectedCash,
          cashSales: sales,
          cashRefunds: refunds,
          cashVariance,
          note: parsed.data.note || undefined,
          closedAt,
        },
      });
      if (update.count !== 1) throw new Error("REGISTER_SHIFT_NOT_OPEN");

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "register_shift.closed",
          entityType: "RegisterShift",
          entityId: shift.id,
          details: {
            storeId: store.id,
            openingCash: shift.openingCash.toString(),
            cashSales: sales.toString(),
            cashRefunds: refunds.toString(),
            expectedCash: expectedCash.toString(),
            closingCash: closingCash.toString(),
            cashVariance: cashVariance.toString(),
            note: parsed.data.note || null,
          },
        },
      });
    });

    revalidatePath("/register-shifts");
    revalidatePath("/dashboard");
    return { status: "success", message: "Register shift closed and cash count recorded." };
  } catch (error) {
    if (error instanceof Error && error.message === "REGISTER_SHIFT_NOT_OPEN") {
      return { status: "error", message: "That register shift is already closed or unavailable. Refresh to continue." };
    }
    if (error instanceof Error && error.message === "REGISTER_SHIFT_HAS_DRAFTS") {
      return { status: "error", message: "Complete or void all held carts before closing the register shift." };
    }
    console.error("Register shift closing failed.", error);
    return { status: "error", message: "The register shift could not be closed. Please try again." };
  }
}
