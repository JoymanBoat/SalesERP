import { after, NextResponse } from "next/server";

import { sendEmailVerification } from "@/lib/email-verification";
import { prisma } from "@/lib/prisma";
import { passwordResetRequestSchema } from "@/lib/validation";

const requestAccepted = {
  message: "If that account exists and is not yet verified, a verification link will be sent.",
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
      select: { id: true, email: true, emailVerified: true },
    });
    if (user && !user.emailVerified) {
      after(async () => {
        try {
          await sendEmailVerification(user);
        } catch (error) {
          console.error("Email-verification request failed.", error);
        }
      });
    }
    return NextResponse.json(requestAccepted, { status: 202 });
  } catch (error) {
    console.error("Email-verification request failed.", error);
    return NextResponse.json(
      { error: "Verification requests are temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }
}
