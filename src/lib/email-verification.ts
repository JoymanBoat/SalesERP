import { AuthTokenType } from "@prisma/client";

import { authBaseUrl, createAuthToken } from "@/lib/auth-token";
import { sendEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

const TOKEN_LIFETIME_MS = 24 * 60 * 60_000;
const RESEND_INTERVAL_MS = 60_000;

/** Creates a one-time verification token and emails the link. Returns false when throttled or already verified. */
export async function sendEmailVerification(user: { id: string; email: string }) {
  const { token, tokenHash } = createAuthToken();
  const now = new Date();

  const created = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    const current = await transaction.user.findUnique({
      where: { id: user.id },
      select: { emailVerified: true },
    });
    if (!current || current.emailVerified) return false;

    const recent = await transaction.authToken.findFirst({
      where: {
        userId: user.id,
        type: AuthTokenType.EMAIL_VERIFICATION,
        createdAt: { gte: new Date(now.getTime() - RESEND_INTERVAL_MS) },
      },
      select: { id: true },
    });
    if (recent) return false;

    await transaction.authToken.deleteMany({
      where: { userId: user.id, type: AuthTokenType.EMAIL_VERIFICATION },
    });
    await transaction.authToken.create({
      data: {
        userId: user.id,
        tokenHash,
        type: AuthTokenType.EMAIL_VERIFICATION,
        expiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS),
      },
    });
    return true;
  });
  if (!created) return false;

  try {
    const url = authBaseUrl();
    url.pathname = "/verify-email";
    url.search = new URLSearchParams({ token }).toString();
    await sendEmail({
      to: user.email,
      subject: "Verify your Keta Retail email address",
      text: [
        "Confirm that this email address belongs to you.",
        "",
        `Use this link within 24 hours: ${url.toString()}`,
        "",
        "If you did not create a Keta Retail account, you can ignore this email.",
      ].join("\n"),
    });
  } catch (error) {
    console.error("Email-verification delivery failed.", error);
    await prisma.authToken.deleteMany({ where: { tokenHash } }).catch(() => undefined);
    return false;
  }
  return true;
}
