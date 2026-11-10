import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { hashAuthToken } from "@/lib/auth-token";
import { prisma } from "@/lib/prisma";
import { assertSubscriptionCapacity, SubscriptionCapacityError, subscriptionCapacityMessage } from "@/lib/subscription-access";
import { acceptEmployeeInvitationSchema } from "@/lib/invitation-validation";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = acceptEmployeeInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the invitation details." },
      { status: 400 },
    );
  }

  const tokenHash = hashAuthToken(parsed.data.token);
  try {
    const invitation = await prisma.employeeInvitation.findFirst({
      where: { tokenHash, expiresAt: { gt: new Date() } },
      select: { id: true, organizationId: true },
    });
    if (!invitation) {
      return NextResponse.json(
        { error: "This invitation link is invalid or expired. Ask the owner to send another invitation." },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Organization"
        WHERE "id" = ${invitation.organizationId}
        FOR UPDATE
      `;
      await transaction.$queryRaw`
        SELECT "id" FROM "EmployeeInvitation"
        WHERE "tokenHash" = ${tokenHash}
          AND "expiresAt" > NOW()
        FOR UPDATE
      `;
      const currentInvitation = await transaction.employeeInvitation.findFirst({
        where: { tokenHash, expiresAt: { gt: new Date() } },
      });
      if (!currentInvitation) throw new Error("EMPLOYEE_INVITATION_INVALID");
      const currentInviter = await transaction.organizationMembership.findFirst({
        where: {
          organizationId: currentInvitation.organizationId,
          userId: currentInvitation.invitedById,
          role: "OWNER",
        },
        select: { id: true },
      });
      if (!currentInviter) throw new Error("EMPLOYEE_INVITATION_REVOKED");
      await assertSubscriptionCapacity(transaction, currentInvitation.organizationId, "staff");

      const existingUser = await transaction.user.findUnique({
        where: { email: currentInvitation.email },
        select: { id: true },
      });
      if (existingUser) throw new Error("EMPLOYEE_INVITATION_ACCOUNT_EXISTS");

      const stores = await transaction.store.findMany({
        where: {
          organizationId: currentInvitation.organizationId,
          active: true,
          id: { in: currentInvitation.storeIds },
        },
        select: { id: true },
      });
      if (stores.length !== currentInvitation.storeIds.length || stores.length === 0) {
        throw new Error("EMPLOYEE_INVITATION_ACCESS_CHANGED");
      }

      const registers = await transaction.posRegister.findMany({
        where: {
          organizationId: currentInvitation.organizationId,
          storeId: { in: stores.map(({ id }) => id) },
          active: true,
          id: { in: currentInvitation.registerIds },
        },
        select: { id: true, storeId: true },
      });
      if (registers.length !== currentInvitation.registerIds.length) {
        throw new Error("EMPLOYEE_INVITATION_ACCESS_CHANGED");
      }

      const user = await transaction.user.create({
        data: {
          name: parsed.data.name,
          email: currentInvitation.email,
          emailVerified: new Date(),
          passwordHash,
        },
        select: { id: true },
      });
      const membership = await transaction.organizationMembership.create({
        data: {
          organizationId: currentInvitation.organizationId,
          userId: user.id,
          role: currentInvitation.role,
        },
        select: { id: true },
      });
      await transaction.organizationStoreAssignment.createMany({
        data: stores.map(({ id }) => ({
          organizationId: currentInvitation.organizationId,
          membershipId: membership.id,
          storeId: id,
        })),
      });
      if (registers.length) {
        await transaction.posRegisterAssignment.createMany({
          data: registers.map(({ id, storeId }) => ({
            organizationId: currentInvitation.organizationId,
            membershipId: membership.id,
            storeId,
            registerId: id,
          })),
        });
      }
      await transaction.auditLog.create({
        data: {
          organizationId: currentInvitation.organizationId,
          actorId: currentInvitation.invitedById,
          action: "organization.invitation_accepted",
          entityType: "OrganizationMembership",
          entityId: membership.id,
          details: {
            email: currentInvitation.email,
            role: currentInvitation.role,
            storeIds: stores.map(({ id }) => id),
            registerIds: registers.map(({ id }) => id),
          },
        },
      });
      await transaction.employeeInvitation.delete({ where: { id: currentInvitation.id } });
    });

    return NextResponse.json({ message: "Your account is ready. Sign in to continue." }, { status: 201 });
  } catch (error) {
    if (error instanceof SubscriptionCapacityError) {
      return NextResponse.json({ error: subscriptionCapacityMessage(error) }, { status: 409 });
    }
    if (error instanceof Error && error.message === "EMPLOYEE_INVITATION_INVALID") {
      return NextResponse.json(
        { error: "This invitation link is invalid or expired. Ask the owner to send another invitation." },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "EMPLOYEE_INVITATION_REVOKED") {
      return NextResponse.json(
        { error: "This invitation is no longer active. Ask a current owner to send a new invitation." },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "EMPLOYEE_INVITATION_ACCOUNT_EXISTS") {
      return NextResponse.json(
        { error: "An account already uses this email. Sign in and ask the owner to add your existing account." },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "EMPLOYEE_INVITATION_ACCESS_CHANGED") {
      return NextResponse.json(
        { error: "The invited store or register access has changed. Ask the owner to send a new invitation." },
        { status: 409 },
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "An account already uses this email. Sign in and ask the owner to add your existing account." },
        { status: 409 },
      );
    }
    console.error("Employee invitation acceptance failed.", error);
    return NextResponse.json(
      { error: "The invitation could not be accepted. Please try again." },
      { status: 500 },
    );
  }
}
