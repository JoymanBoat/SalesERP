"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function switchActiveOrganization(formData: FormData) {
  const organizationId = formData.get("organizationId");
  if (typeof organizationId !== "string" || organizationId.length === 0 || organizationId.length > 40) {
    redirect("/dashboard?workspaceError=invalid");
  }

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.revoked) redirect("/login?revoked=1");
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: session.user.id, organizationId },
    select: { id: true },
  });
  if (!membership) redirect("/dashboard?workspaceError=unavailable");

  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
  cookieStore.set("saleserp-organization-id", organizationId, cookieOptions);
  cookieStore.delete("saleserp-store-id");
  cookieStore.delete("saleserp-register-id");
  redirect("/dashboard");
}
