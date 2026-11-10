"use server";


import { MembershipRole, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { authBaseUrl, createAuthToken } from "@/lib/auth-token";
import { sendEmail } from "@/lib/email";
import { employeeInvitationSchema } from "@/lib/invitation-validation";
import { canManageOrganizationMembers } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertSubscriptionCapacity, SubscriptionCapacityError, subscriptionCapacityMessage } from "@/lib/subscription-access";
import { getWorkspace } from "@/lib/workspace";
import {
  addOrganizationMemberSchema,
  organizationMemberRegistersSchema,
  organizationMemberStoresSchema,
  removeOrganizationMemberSchema,
  updateOrganizationMemberRoleSchema,
} from "@/lib/validation";

export type TeamActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

function isOwner(role: MembershipRole) {
  return role === MembershipRole.OWNER;
}

async function assertCurrentOwner(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
) {
  const currentMembership = await transaction.organizationMembership.findFirst({
    where: { organizationId, userId, role: MembershipRole.OWNER },
    select: { id: true },
  });
  if (!currentMembership) throw new Error("TEAM_ACTOR_NOT_OWNER");
}

export async function addOrganizationMember(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed = addOrganizationMemberSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
    storeIds: formData.getAll("storeIds"),
    registerIds: formData.getAll("registerIds"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the employee details." };

  const { organization, membership } = await getWorkspace({ operation: "change" });
  if (!canManageOrganizationMembers(membership.role)) {
    return { status: "error", message: "Only an organization owner can manage employee access." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      await assertCurrentOwner(transaction, organization.id, membership.userId);
      const user = await transaction.user.findUnique({
        where: { email: parsed.data.email },
        select: { id: true, email: true, name: true, emailVerified: true },
      });
      if (!user) throw new Error("TEAM_USER_NOT_FOUND");
      if (!user.emailVerified) throw new Error("TEAM_USER_EMAIL_UNVERIFIED");

      const existing = await transaction.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
        select: { id: true },
      });
      if (existing) throw new Error("TEAM_MEMBER_ALREADY_EXISTS");
      await assertSubscriptionCapacity(transaction, organization.id, "staff");
      const stores = await transaction.store.findMany({
        where: {
          organizationId: organization.id,
          active: true,
          id: { in: parsed.data.storeIds },
        },
        select: { id: true },
      });
      if (stores.length !== parsed.data.storeIds.length) throw new Error("TEAM_STORES_UNAVAILABLE");
      const registers = await transaction.posRegister.findMany({
        where: {
          organizationId: organization.id,
          storeId: { in: stores.map(({ id }) => id) },
          active: true,
          id: { in: parsed.data.registerIds },
        },
        select: { id: true, storeId: true },
      });
      if (registers.length !== parsed.data.registerIds.length) throw new Error("TEAM_REGISTERS_UNAVAILABLE");

      const newMembership = await transaction.organizationMembership.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: parsed.data.role,
        },
      });
      await transaction.organizationStoreAssignment.createMany({
        data: stores.map(({ id }) => ({
          organizationId: organization.id,
          membershipId: newMembership.id,
          storeId: id,
        })),
      });
      if (registers.length) {
        await transaction.posRegisterAssignment.createMany({
          data: registers.map(({ id, storeId }) => ({
            organizationId: organization.id,
            membershipId: newMembership.id,
            storeId,
            registerId: id,
          })),
        });
      }
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "organization.member_added",
          entityType: "OrganizationMembership",
          entityId: newMembership.id,
          details: { email: user.email, name: user.name, role: newMembership.role, storeIds: stores.map(({ id }) => id), registerIds: registers.map(({ id }) => id) },
        },
      });
    });
    revalidatePath("/team");
    revalidatePath("/dashboard");
    return { status: "success", message: "Employee access added." };
  } catch (error) {
    if (error instanceof SubscriptionCapacityError) return { status: "error", message: subscriptionCapacityMessage(error) };
    if (error instanceof Error && error.message === "TEAM_USER_NOT_FOUND") {
      return { status: "error", message: "No account uses that email. The employee must create an account before access can be granted." };
    }
    if (error instanceof Error && error.message === "TEAM_USER_EMAIL_UNVERIFIED") {
      return { status: "error", message: "That account's email is not verified. Send an email invitation instead so the employee confirms ownership of the address." };
    }
    if (error instanceof Error && error.message === "TEAM_MEMBER_ALREADY_EXISTS") {
      return { status: "error", message: "That account already has access to this organization." };
    }
    if (error instanceof Error && error.message === "TEAM_STORES_UNAVAILABLE") {
      return { status: "error", message: "Choose only active stores belonging to this organization." };
    }
    if (error instanceof Error && error.message === "TEAM_REGISTERS_UNAVAILABLE") {
      return { status: "error", message: "Choose only active POS registers in the assigned stores." };
    }
    if (error instanceof Error && error.message === "TEAM_ACTOR_NOT_OWNER") {
      return { status: "error", message: "Only a current organization owner can manage employee access." };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "That employee already has access to this organization." };
    }
    console.error("Organization member creation failed.", error);
    return { status: "error", message: "Employee access could not be added. Please try again." };
  }
}

export async function inviteOrganizationMember(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed = employeeInvitationSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
    storeIds: formData.getAll("storeIds"),
    registerIds: formData.getAll("registerIds"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the invitation details." };
  }

  const { organization, membership } = await getWorkspace({ operation: "change" });
  if (!canManageOrganizationMembers(membership.role)) {
    return { status: "error", message: "Only an organization owner can invite employees." };
  }

  const { token, tokenHash } = createAuthToken();
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      await assertCurrentOwner(transaction, organization.id, membership.userId);
      await assertSubscriptionCapacity(transaction, organization.id, "staff");

      const existingUser = await transaction.user.findUnique({
        where: { email: parsed.data.email },
        select: { id: true },
      });
      if (existingUser) throw new Error("TEAM_INVITATION_ACCOUNT_EXISTS");

      const pendingInvitation = await transaction.employeeInvitation.findFirst({
        where: { organizationId: organization.id, email: parsed.data.email, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (pendingInvitation) throw new Error("TEAM_INVITATION_ALREADY_PENDING");
      await transaction.employeeInvitation.deleteMany({
        where: { organizationId: organization.id, email: parsed.data.email },
      });

      const stores = await transaction.store.findMany({
        where: {
          organizationId: organization.id,
          active: true,
          id: { in: parsed.data.storeIds },
        },
        select: { id: true },
      });
      if (stores.length !== parsed.data.storeIds.length) throw new Error("TEAM_STORES_UNAVAILABLE");
      const registers = await transaction.posRegister.findMany({
        where: {
          organizationId: organization.id,
          storeId: { in: stores.map(({ id }) => id) },
          active: true,
          id: { in: parsed.data.registerIds },
        },
        select: { id: true },
      });
      if (registers.length !== parsed.data.registerIds.length) throw new Error("TEAM_REGISTERS_UNAVAILABLE");

      await transaction.employeeInvitation.create({
        data: {
          organizationId: organization.id,
          invitedById: membership.userId,
          email: parsed.data.email,
          role: parsed.data.role,
          storeIds: stores.map(({ id }) => id),
          registerIds: parsed.data.registerIds,
          tokenHash,
          expiresAt: new Date(Date.now() + 72 * 60 * 60_000),
        },
      });
    });

    try {
      const invitationUrl = authBaseUrl();
      invitationUrl.pathname = "/accept-invitation";
      invitationUrl.search = new URLSearchParams({ token }).toString();
      await sendEmail({
        to: parsed.data.email,
        subject: `Join ${organization.name} on Keta Retail`,
        text: [
          `You have been invited to join ${organization.name} on Keta Retail.`,
          "",
          `Role: ${parsed.data.role.replaceAll("_", " ").toLowerCase()}`,
          `Use this link within 72 hours to create your account: ${invitationUrl.toString()}`,
          "",
          "If you were not expecting this invitation, you can ignore this email.",
        ].join("\n"),
      });
    } catch (error) {
      console.error("Employee invitation email delivery failed.", error);
      try {
        await prisma.employeeInvitation.deleteMany({ where: { tokenHash } });
      } catch (cleanupError) {
        console.error("Failed to remove an undelivered employee invitation.", cleanupError);
      }
      return { status: "error", message: "The invitation email could not be sent. Check SMTP settings and try again." };
    }

    revalidatePath("/team");
    return { status: "success", message: `An invitation was sent to ${parsed.data.email}.` };
  } catch (error) {
    if (error instanceof SubscriptionCapacityError) return { status: "error", message: subscriptionCapacityMessage(error) };
    if (error instanceof Error && error.message === "TEAM_INVITATION_ACCOUNT_EXISTS") {
      return { status: "error", message: "An account already uses that email. Add the existing account instead." };
    }
    if (error instanceof Error && error.message === "TEAM_INVITATION_ALREADY_PENDING") {
      return { status: "error", message: "An active invitation already exists for that email." };
    }
    if (error instanceof Error && error.message === "TEAM_STORES_UNAVAILABLE") {
      return { status: "error", message: "Choose only active stores belonging to this organization." };
    }
    if (error instanceof Error && error.message === "TEAM_REGISTERS_UNAVAILABLE") {
      return { status: "error", message: "Choose only active POS registers in the assigned stores." };
    }
    if (error instanceof Error && error.message === "TEAM_ACTOR_NOT_OWNER") {
      return { status: "error", message: "Only a current organization owner can invite employees." };
    }
    console.error("Employee invitation creation failed.", error);
    return { status: "error", message: "The employee invitation could not be created. Please try again." };
  }
}

export async function updateOrganizationMemberStores(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed = organizationMemberStoresSchema.safeParse({
    membershipId: formData.get("membershipId"),
    storeIds: formData.getAll("storeIds"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Select at least one active store." };
  }

  const { organization, membership } = await getWorkspace({ operation: "change" });
  if (!canManageOrganizationMembers(membership.role)) {
    return { status: "error", message: "Only an organization owner can manage employee access." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      await assertCurrentOwner(transaction, organization.id, membership.userId);
      const target = await transaction.organizationMembership.findFirst({
        where: { id: parsed.data.membershipId, organizationId: organization.id },
        select: { id: true, role: true, user: { select: { email: true } } },
      });
      if (!target) throw new Error("TEAM_MEMBER_NOT_FOUND");
      if (isOwner(target.role)) throw new Error("TEAM_OWNER_ASSIGNMENT_PROTECTED");

      const stores = await transaction.store.findMany({
        where: {
          organizationId: organization.id,
          active: true,
          id: { in: parsed.data.storeIds },
        },
        select: { id: true },
      });
      if (stores.length !== parsed.data.storeIds.length) throw new Error("TEAM_STORES_UNAVAILABLE");

      await transaction.organizationStoreAssignment.deleteMany({
        where: { organizationId: organization.id, membershipId: target.id },
      });
      await transaction.organizationStoreAssignment.createMany({
        data: stores.map(({ id }) => ({
          organizationId: organization.id,
          membershipId: target.id,
          storeId: id,
        })),
      });
      await transaction.posRegisterAssignment.deleteMany({
        where: {
          organizationId: organization.id,
          membershipId: target.id,
          storeId: { notIn: parsed.data.storeIds },
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "organization.member_stores_updated",
          entityType: "OrganizationMembership",
          entityId: target.id,
          details: { email: target.user.email, storeIds: stores.map(({ id }) => id) },
        },
      });
    });
    revalidatePath("/team");
    revalidatePath("/dashboard");
    return { status: "success", message: "Employee store access updated." };
  } catch (error) {
    if (error instanceof Error && error.message === "TEAM_MEMBER_NOT_FOUND") {
      return { status: "error", message: "That employee is no longer a member of this organization." };
    }
    if (error instanceof Error && error.message === "TEAM_OWNER_ASSIGNMENT_PROTECTED") {
      return { status: "error", message: "Owners automatically have access to every active store." };
    }
    if (error instanceof Error && error.message === "TEAM_STORES_UNAVAILABLE") {
      return { status: "error", message: "Choose only active stores belonging to this organization." };
    }
    if (error instanceof Error && error.message === "TEAM_ACTOR_NOT_OWNER") {
      return { status: "error", message: "Only a current organization owner can manage employee access." };
    }
    console.error("Organization member store assignment failed.", error);
    return { status: "error", message: "Employee store access could not be updated. Please try again." };
  }
}

export async function updateOrganizationMemberRegisters(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed = organizationMemberRegistersSchema.safeParse({
    membershipId: formData.get("membershipId"),
    registerIds: formData.getAll("registerIds"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the POS register assignments." };

  const { organization, membership } = await getWorkspace({ operation: "change" });
  if (!canManageOrganizationMembers(membership.role)) {
    return { status: "error", message: "Only an organization owner can manage employee access." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      await assertCurrentOwner(transaction, organization.id, membership.userId);
      const target = await transaction.organizationMembership.findFirst({
        where: { id: parsed.data.membershipId, organizationId: organization.id },
        select: { id: true, role: true, user: { select: { email: true } } },
      });
      if (!target) throw new Error("TEAM_MEMBER_NOT_FOUND");
      if (isOwner(target.role)) throw new Error("TEAM_OWNER_ASSIGNMENT_PROTECTED");
      const assignedStores = await transaction.organizationStoreAssignment.findMany({
        where: { organizationId: organization.id, membershipId: target.id },
        select: { storeId: true },
      });
      const registers = await transaction.posRegister.findMany({
        where: {
          organizationId: organization.id,
          storeId: { in: assignedStores.map(({ storeId }) => storeId) },
          active: true,
          id: { in: parsed.data.registerIds },
        },
        select: { id: true, storeId: true },
      });
      if (registers.length !== parsed.data.registerIds.length) throw new Error("TEAM_REGISTERS_UNAVAILABLE");

      await transaction.posRegisterAssignment.deleteMany({
        where: { organizationId: organization.id, membershipId: target.id },
      });
      if (registers.length) {
        await transaction.posRegisterAssignment.createMany({
          data: registers.map(({ id, storeId }) => ({
            organizationId: organization.id,
            membershipId: target.id,
            storeId,
            registerId: id,
          })),
        });
      }
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "organization.member_registers_updated",
          entityType: "OrganizationMembership",
          entityId: target.id,
          details: { email: target.user.email, registerIds: registers.map(({ id }) => id) },
        },
      });
    });
    revalidatePath("/team");
    revalidatePath("/pos");
    revalidatePath("/register-shifts");
    return { status: "success", message: "Employee POS register access updated." };
  } catch (error) {
    if (error instanceof Error && error.message === "TEAM_MEMBER_NOT_FOUND") return { status: "error", message: "That employee is no longer a member of this organization." };
    if (error instanceof Error && error.message === "TEAM_OWNER_ASSIGNMENT_PROTECTED") return { status: "error", message: "Owners automatically have access to every active POS register." };
    if (error instanceof Error && error.message === "TEAM_REGISTERS_UNAVAILABLE") return { status: "error", message: "Choose only active POS registers in stores assigned to this employee." };
    if (error instanceof Error && error.message === "TEAM_ACTOR_NOT_OWNER") return { status: "error", message: "Only a current organization owner can manage employee access." };
    console.error("Organization member register assignment failed.", error);
    return { status: "error", message: "Employee POS register access could not be updated. Please try again." };
  }
}

export async function updateOrganizationMemberRole(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed = updateOrganizationMemberRoleSchema.safeParse({
    membershipId: formData.get("membershipId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Select a valid employee role." };

  const { organization, membership } = await getWorkspace({ operation: "change" });
  if (!canManageOrganizationMembers(membership.role)) {
    return { status: "error", message: "Only an organization owner can manage employee access." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      await assertCurrentOwner(transaction, organization.id, membership.userId);
      const target = await transaction.organizationMembership.findFirst({
        where: { id: parsed.data.membershipId, organizationId: organization.id },
        include: { user: { select: { email: true, name: true } } },
      });
      if (!target) throw new Error("TEAM_MEMBER_NOT_FOUND");
      if (isOwner(target.role)) throw new Error("TEAM_OWNER_ROLE_PROTECTED");

      await transaction.organizationMembership.update({
        where: { id: target.id },
        data: { role: parsed.data.role },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "organization.member_role_updated",
          entityType: "OrganizationMembership",
          entityId: target.id,
          details: { email: target.user.email, previousRole: target.role, role: parsed.data.role },
        },
      });
    });
    revalidatePath("/team");
    revalidatePath("/dashboard");
    return { status: "success", message: "Employee role updated." };
  } catch (error) {
    if (error instanceof Error && error.message === "TEAM_MEMBER_NOT_FOUND") return { status: "error", message: "That employee is no longer a member of this organization." };
    if (error instanceof Error && error.message === "TEAM_OWNER_ROLE_PROTECTED") return { status: "error", message: "An owner role cannot be changed through employee role management." };
    if (error instanceof Error && error.message === "TEAM_ACTOR_NOT_OWNER") return { status: "error", message: "Only a current organization owner can manage employee access." };
    console.error("Organization member role update failed.", error);
    return { status: "error", message: "The employee role could not be updated. Please try again." };
  }
}

export async function removeOrganizationMember(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed = removeOrganizationMemberSchema.safeParse({
    membershipId: formData.get("membershipId"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Select a valid employee." };

  const { organization, membership } = await getWorkspace({ operation: "change" });
  if (!canManageOrganizationMembers(membership.role)) {
    return { status: "error", message: "Only an organization owner can manage employee access." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organization.id} FOR UPDATE`;
      await assertCurrentOwner(transaction, organization.id, membership.userId);
      const target = await transaction.organizationMembership.findFirst({
        where: { id: parsed.data.membershipId, organizationId: organization.id },
        include: { user: { select: { email: true, name: true } } },
      });
      if (!target) throw new Error("TEAM_MEMBER_NOT_FOUND");

      if (isOwner(target.role)) {
        const ownerCount = await transaction.organizationMembership.count({
          where: { organizationId: organization.id, role: MembershipRole.OWNER },
        });
        if (ownerCount <= 1) throw new Error("TEAM_LAST_OWNER");
      }

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: "organization.member_removed",
          entityType: "OrganizationMembership",
          entityId: target.id,
          details: { email: target.user.email, name: target.user.name, role: target.role },
        },
      });
      await transaction.organizationMembership.delete({ where: { id: target.id } });
    });
    revalidatePath("/team");
    revalidatePath("/dashboard");
    return { status: "success", message: "Employee access removed." };
  } catch (error) {
    if (error instanceof Error && error.message === "TEAM_MEMBER_NOT_FOUND") return { status: "error", message: "That employee is no longer a member of this organization." };
    if (error instanceof Error && error.message === "TEAM_LAST_OWNER") return { status: "error", message: "The organization must have at least one owner." };
    if (error instanceof Error && error.message === "TEAM_ACTOR_NOT_OWNER") return { status: "error", message: "Only a current organization owner can manage employee access." };
    console.error("Organization member removal failed.", error);
    return { status: "error", message: "Employee access could not be removed. Please try again." };
  }
}
