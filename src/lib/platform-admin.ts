import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function isPlatformAdmin(userId: string) {
  return (await prisma.platformAdmin.findUnique({ where: { userId }, select: { userId: true } })) !== null;
}

export async function requirePlatformAdmin() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.revoked) redirect("/login?revoked=1");
  if (!(await isPlatformAdmin(session.user.id))) redirect("/dashboard?denied=1");
  return session;
}
