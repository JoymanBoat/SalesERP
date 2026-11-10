import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { after, NextResponse } from "next/server";

import { sendEmailVerification } from "@/lib/email-verification";
import { prisma } from "@/lib/prisma";
import { registrationSchema, slugify } from "@/lib/validation";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = registrationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the form fields and use a password of at least 12 characters." },
      { status: 400 },
    );
  }

  const { ownerName, businessName, storeName, email, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);
  const slug = `${slugify(businessName)}-${crypto.randomUUID().slice(0, 8)}`;
  const storeCode = slugify(storeName).slice(0, 24).toUpperCase() || "MAIN";

  try {
    const created = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: { name: ownerName, email, passwordHash },
      });
      const organization = await transaction.organization.create({
        data: {
          name: businessName,
          slug,
          currency: "GHS",
          countryCode: "GH",
          timezone: "Africa/Accra",
        },
      });

      await transaction.organizationMembership.create({
        data: { organizationId: organization.id, userId: user.id, role: "OWNER" },
      });
      const store = await transaction.store.create({
        data: {
          organizationId: organization.id,
          name: storeName,
          code: storeCode,
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
      return user;
    });

    after(async () => {
      try {
        await sendEmailVerification({ id: created.id, email: created.email });
      } catch (error) {
        console.error("Registration verification email failed.", error);
      }
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes("email")
    ) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    }

    console.error("Business registration failed.", error);
    return NextResponse.json(
      { error: "We could not create the business account. Please try again." },
      { status: 500 },
    );
  }
}
