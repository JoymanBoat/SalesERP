import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { hasWorkspaceMembership } from "@/lib/workspace";
import { isPlatformAdmin } from "@/lib/platform-admin";

export default async function HomePage() {
  const session = await auth();
  if (session?.user?.id && !session.revoked && await isPlatformAdmin(session.user.id)) redirect("/platform");
  const hasWorkspace = session?.user?.id && !session.revoked
    ? await hasWorkspaceMembership(session.user.id)
    : false;
  redirect(hasWorkspace ? "/dashboard" : "/login");
}
