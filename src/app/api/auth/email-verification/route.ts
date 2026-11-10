import { AuthTokenType } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { hashAuthToken } from "@/lib/auth-token";
import { prisma } from "@/lib/prisma";

const confirmSchema = z.object({ token: z.string().min(20).max(200) });
const invalid = { error: "This verification link is invalid or expired. Request a new link." };

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(invalid, { status: 400 });

  const tokenHash = hashAuthToken(parsed.data.token);

  try {
    const verified = await prisma.$transaction(async (transaction) => {
      const token = await transaction.authToken.findFirst({
        where: {
          tokenHash,
          type: AuthTokenType.EMAIL_VERIFICATION,
          expiresAt: { gt: new Date() },
        },
        select: { userId: true },
      });
      if (!token) return false;

      // Deleting first makes the one-time claim atomic under concurrent requests.
      const claimed = await transaction.authToken.deleteMany({
        where: { tokenHash, type: AuthTokenType.EMAIL_VERIFICATION },
      });
      if (claimed.count !== 1) return false;

      await transaction.user.updateMany({
        where: { id: token.userId, emailVerified: null },
        data: { emailVerified: new Date() },
      });
      return true;
    });
    if (!verified) return NextResponse.json(invalid, { status: 400 });
    return NextResponse.json({ message: "Your email address is verified." });
  } catch (error) {
    console.error("Email verification failed.", error);
    return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 500 });
  }
}
