import Link from "next/link";
import { MembershipRole } from "@prisma/client";

import { StoreManagement } from "@/components/store-management";
import { WorkspaceShell } from "@/components/workspace-shell";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

export default async function StoresPage() {
  const { session, membership, organization, store } = await getWorkspace({ allowedRoles: [MembershipRole.OWNER], operation: "view" });
  const stores = await prisma.store.findMany({
    where: { organizationId: organization.id },
    orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, code: true, address: true, active: true, createdAt: true },
  });
  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeZone: organization.timezone,
  });

  return (
    <WorkspaceShell
      activeSection="stores"
      membershipId={membership.id}
      currency={organization.currency}
      organizationId={organization.id}
      organizationName={organization.name}
      role={membership.role}
      storeId={store.id}
      storeName={store.name}
      userName={session.user.name ?? session.user.email ?? "User"}
    >
      <header className="workspace-header">
        <div>
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Stores</p>
          <h1>Store setup</h1>
          <p className="header-note">Configure active locations for {organization.name}.</p>
        </div>
        <div className="header-store">{stores.filter((item) => item.active).length} active<span>Organization locations</span></div>
      </header>

      <StoreManagement
        stores={stores.map((item) => ({
          ...item,
          createdAt: dateFormatter.format(item.createdAt),
        }))}
      />
      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
