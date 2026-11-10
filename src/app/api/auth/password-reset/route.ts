import { AuthTokenType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { hashAuthToken } from "@/lib/auth-token";
import { prisma } from "@/lib/prisma";
import { passwordResetSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = passwordResetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the password-reset details." },
      { status: 400 },
    );
  }

  const tokenHash = hashAuthToken(parsed.data.token);

  try {
    const activeToken = await prisma.authToken.findFirst({
      where: {
        tokenHash,
        type: AuthTokenType.PASSWORD_RESET,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!activeToken) {
      return NextResponse.json(
        { error: "This password-reset link is invalid or expired. Request a new link." },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "AuthToken"
        WHERE "tokenHash" = ${tokenHash}
          AND "type" = ${AuthTokenType.PASSWORD_RESET}::"AuthTokenType"
          AND "expiresAt" > NOW()
        FOR UPDATE
      `;
      const token = await transaction.authToken.findFirst({
        where: {
          tokenHash,
          type: AuthTokenType.PASSWORD_RESET,
          expiresAt: { gt: new Date() },
        },
        select: { id: true, userId: true },
      });
      if (!token) throw new Error("PASSWORD_RESET_TOKEN_INVALID");

      await transaction.user.update({
        where: { id: token.userId },
        data: {
          passwordHash,
          sessionVersion: { increment: 1 },
        },
      });
      await transaction.authToken.deleteMany({ where: { userId: token.userId } });
    });

    return NextResponse.json({ message: "Your password has been updated. Sign in with your new password." });
  } catch (error) {
    if (error instanceof Error && error.message === "PASSWORD_RESET_TOKEN_INVALID") {
      return NextResponse.json(
        { error: "This password-reset link is invalid or expired. Request a new link." },
        { status: 400 },
      );
    }
    console.error("Password reset failed.", error);
    return NextResponse.json(
      { error: "The password could not be updated. Please try again." },
      { status: 500 },
    );
  }
}
