import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";

import { OrganizationSwitcher } from "@/components/organization-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function StoreAccessPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.revoked) redirect("/login?revoked=1");
  const [memberships, cookieStore] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { userId: session.user.id },
      orderBy: [{ createdAt: "asc" }, { organizationId: "asc" }],
      select: { organizationId: true, organization: { select: { name: true } } },
    }),
    cookies(),
  ]);
  const selectedOrganizationId = cookieStore.get("saleserp-organization-id")?.value;

  return (
    <main className="store-access-page">
      <section className="data-panel">
        <p className="eyebrow">Store access</p>
        <h1>No active store is assigned to your account</h1>
        <p>Ask an organization owner to assign you to at least one active store. After that, return to your workspace to continue.</p>
        <OrganizationSwitcher
          organizations={memberships.map(({ organizationId, organization }) => ({ id: organizationId, name: organization.name }))}
          selectedOrganizationId={memberships.find(({ organizationId }) => organizationId === selectedOrganizationId)?.organizationId
            ?? memberships[0]?.organizationId
            ?? ""}
        />
        <Link className="customer-filter-link" href="/dashboard">Return to workspace</Link>
        <SignOutButton />
      </section>
    </main>
  );
}
