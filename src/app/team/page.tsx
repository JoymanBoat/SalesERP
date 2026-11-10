import Link from "next/link";
import { MembershipRole } from "@prisma/client";

import { TeamManagement } from "@/components/team-management";
import { WorkspaceShell } from "@/components/workspace-shell";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";

export default async function TeamPage() {
  const { session, membership, organization, store } = await getWorkspace({ allowedRoles: [MembershipRole.OWNER], operation: "view" });

  const [employees, stores, registers] = await Promise.all([
    prisma.organizationMembership.findMany({
    where: { organizationId: organization.id },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      include: {
        user: { select: { name: true, email: true } },
        storeAssignments: { select: { storeId: true } },
        registerAssignments: { select: { registerId: true } },
      },
    }),
    prisma.store.findMany({
      where: { organizationId: organization.id, active: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, code: true },
    }),
    prisma.posRegister.findMany({
      where: { organizationId: organization.id, active: true, store: { active: true } },
      orderBy: [{ store: { name: "asc" } }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, code: true, storeId: true, store: { select: { name: true } } },
    }),
  ]);
  const dateFormatter = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeZone: organization.timezone,
  });

  return (
    <WorkspaceShell
      activeSection="team"
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
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Team</p>
          <h1>Employee access</h1>
          <p className="header-note">Manage registered accounts and organization roles for {organization.name}.</p>
        </div>
        <div className="header-store">{employees.length.toLocaleString("en-GH")} members<span>Organization access</span></div>
      </header>

      <TeamManagement
        currentMembershipId={membership.id}
        stores={stores}
        registers={registers}
        employees={employees.map((employee) => ({
          membershipId: employee.id,
          name: employee.user.name,
          email: employee.user.email,
          role: employee.role,
          joinedAt: dateFormatter.format(employee.createdAt),
          assignedStoreIds: employee.storeAssignments.map(({ storeId }) => storeId),
          assignedRegisterIds: employee.registerAssignments.map(({ registerId }) => registerId),
        }))}
      />
      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
