import { AuthTokenType } from "@prisma/client";
import { after, NextResponse } from "next/server";

import { createAuthToken, authBaseUrl } from "@/lib/auth-token";
import { sendEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { passwordResetRequestSchema } from "@/lib/validation";

const requestAccepted = {
  message: "If an account exists for that email, a password-reset link will be sent.",
};

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = passwordResetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, email: true },
    });
    if (!user) return NextResponse.json(requestAccepted, { status: 202 });

    const { token, tokenHash } = createAuthToken();
    const now = new Date();
    const created = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE
      `;
      const recentRequest = await transaction.authToken.findFirst({
        where: {
          userId: user.id,
          type: AuthTokenType.PASSWORD_RESET,
          createdAt: { gte: new Date(now.getTime() - 60_000) },
        },
        select: { id: true },
      });
      if (recentRequest) return false;

      await transaction.authToken.deleteMany({
        where: { userId: user.id, type: AuthTokenType.PASSWORD_RESET },
      });
      await transaction.authToken.create({
        data: {
          userId: user.id,
          tokenHash,
          type: AuthTokenType.PASSWORD_RESET,
          expiresAt: new Date(now.getTime() + 30 * 60_000),
        },
      });
      return true;
    });
    if (!created) return NextResponse.json(requestAccepted, { status: 202 });

    after(async () => {
      try {
        const resetUrl = authBaseUrl();
        resetUrl.pathname = "/reset-password";
        resetUrl.search = new URLSearchParams({ token }).toString();
        await sendEmail({
          to: user.email,
          subject: "Reset your Keta Retail password",
          text: [
            "A password reset was requested for your Keta Retail account.",
            "",
            `Use this link within 30 minutes: ${resetUrl.toString()}`,
            "",
            "If you did not request this, you can ignore this email.",
          ].join("\n"),
        });
      } catch (error) {
        console.error("Password-reset email delivery failed.", error);
        try {
          await prisma.authToken.deleteMany({ where: { tokenHash } });
        } catch (cleanupError) {
          console.error("Failed to remove unusable password-reset token.", cleanupError);
        }
      }
    });

    return NextResponse.json(requestAccepted, { status: 202 });
  } catch (error) {
    console.error("Password-reset request failed.", error);
    return NextResponse.json(
      { error: "Password-reset requests are temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }
}
