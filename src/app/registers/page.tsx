import Link from "next/link";
import { MembershipRole } from "@prisma/client";

import { PosRegisterManagement } from "@/components/pos-register-management";
import { WorkspaceShell } from "@/components/workspace-shell";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

export default async function PosRegistersPage() {
  const { session, membership, organization, store } = await getWorkspace({ allowedRoles: [MembershipRole.OWNER], feature: "pos", operation: "view" });
  const registers = await prisma.posRegister.findMany({
    where: { organizationId: organization.id, storeId: store.id },
    orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
    include: { shifts: { where: { closedAt: null }, select: { id: true }, take: 1 } },
  });

  return (
    <WorkspaceShell
      activeSection="registers"
      membershipId={membership.id}
      organizationId={organization.id}
      currency={organization.currency}
      organizationName={organization.name}
      role={membership.role}
      storeId={store.id}
      storeName={store.name}
      userName={session.user.name ?? session.user.email ?? "User"}
    >
      <header className="workspace-header">
        <div>
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / POS registers</p>
          <h1>POS registers</h1>
          <p className="header-note">Manage named checkout stations and shifts at {store.name}.</p>
        </div>
        <div className="header-store">{registers.filter(({ active }) => active).length} active<span>{store.name}</span></div>
      </header>
      <PosRegisterManagement registers={registers.map((register) => ({
        id: register.id,
        name: register.name,
        code: register.code,
        active: register.active,
        openShift: register.shifts.length > 0,
      }))} />
      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
