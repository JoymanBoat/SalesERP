import type { MembershipRole } from "@prisma/client";
import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { SignOutButton } from "@/components/sign-out-button";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { RegisterSwitcher } from "@/components/register-switcher";
import { StoreSwitcher } from "@/components/store-switcher";
import { WorkspaceMutationContext } from "@/components/workspace-mutation-context";
import { canManagePricing, getVisibleNotificationTypes } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getOrganizationSubscription } from "@/lib/subscription-access";
import { canUseSubscriptionFeature, subscriptionIsReadOnly, type SubscriptionFeature } from "@/lib/subscription-policy";

type WorkspaceSection = "overview" | "products" | "inventory" | "customers" | "suppliers" | "purchasing" | "pos" | "promotions" | "gift-cards" | "register-shifts" | "reports" | "notifications" | "team" | "stores" | "registers" | "audit-logs" | "settings" | "subscription";

export async function WorkspaceShell({
  children,
  membershipId,
  organizationId,
  organizationName,
  storeId,
  storeName,
  currency,
  userName,
  role,
  activeSection,
}: {
  children: ReactNode;
  membershipId: string;
  organizationId: string;
  organizationName: string;
  storeId: string;
  storeName: string;
  currency: string;
  userName: string;
  role: MembershipRole;
  activeSection: WorkspaceSection;
}) {
  const [currentMembership, stores] = await Promise.all([
    prisma.organizationMembership.findUnique({
      where: { id: membershipId },
      select: { userId: true },
    }),
    prisma.store.findMany({
      where: {
        organizationId,
        active: true,
        ...(role === "OWNER" ? {} : { employeeAssignments: { some: { membershipId } } }),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, code: true },
    }),
  ]);
  if (!currentMembership) throw new Error("The current workspace membership no longer exists.");
  const organizations = await prisma.organizationMembership.findMany({
    where: { userId: currentMembership.userId },
    orderBy: [{ createdAt: "asc" }, { organizationId: "asc" }],
    select: { organizationId: true, organization: { select: { name: true } } },
  });
  const registers = await prisma.posRegister.findMany({
    where: {
      organizationId,
      storeId,
      active: true,
      ...(role === "OWNER" ? {} : { assignments: { some: { membershipId } } }),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, code: true },
  });
  const savedRegisterId = (await cookies()).get("saleserp-register-id")?.value;
  const selectedRegisterId = registers.find(({ id }) => id === savedRegisterId)?.id ?? registers[0]?.id ?? null;
  const unreadNotificationCount = stores.length > 0
    ? await prisma.inAppNotification.count({
        where: {
          organizationId,
          membershipId,
          storeId: { in: stores.map(({ id }) => id) },
          readAt: null,
          type: { in: getVisibleNotificationTypes(role) },
        },
      })
    : 0;
  const subscription = await getOrganizationSubscription(prisma, organizationId);
  const now = new Date();
  const sections: { id: WorkspaceSection; label: string; href: string; feature?: SubscriptionFeature }[] = [
    { id: "overview", label: "Overview", href: "/dashboard" },
    { id: "products", label: "Products", href: "/products", feature: "inventory" },
    { id: "inventory", label: "Inventory", href: "/inventory", feature: "inventory" },
    { id: "customers", label: "Customers", href: "/customers", feature: "customers" },
    { id: "suppliers", label: "Suppliers", href: "/suppliers", feature: "suppliers" },
    { id: "purchasing", label: "Purchasing", href: "/purchasing", feature: "purchasing" },
    { id: "pos", label: "Point of sale", href: "/pos", feature: "pos" },
    ...(canManagePricing(role) ? [{ id: "promotions" as const, label: "Promotions", href: "/promotions", feature: "promotions" as const }] : []),
    ...(canManagePricing(role) ? [{ id: "gift-cards" as const, label: "Gift cards", href: "/gift-cards", feature: "giftCards" as const }] : []),
    { id: "register-shifts", label: "Register shifts", href: "/register-shifts", feature: "pos" },
    { id: "reports", label: "Reports", href: "/reports", feature: "reports" },
    { id: "notifications", label: unreadNotificationCount > 0 ? `Notifications (${unreadNotificationCount})` : "Notifications", href: "/notifications" },
    ...(role === "OWNER" ? [{ id: "team" as const, label: "Team", href: "/team" }] : []),
    ...(role === "OWNER" ? [{ id: "stores" as const, label: "Stores", href: "/stores" }] : []),
    ...(role === "OWNER" ? [{ id: "registers" as const, label: "POS registers", href: "/registers" }] : []),
    ...(role === "OWNER" ? [{ id: "audit-logs" as const, label: "Audit history", href: "/audit-logs" }] : []),
    ...(canManagePricing(role) ? [{ id: "settings" as const, label: "Settings", href: "/settings" }] : []),
    { id: "subscription", label: "Subscription", href: "/subscription" },
  ];
  const visibleSections = sections.filter(({ feature }) => !feature || canUseSubscriptionFeature(subscription, feature, "view", now));
  const navigation = (
    <nav className="workspace-nav" aria-label="Main navigation">
      {visibleSections.map((section) => (
        <a
          aria-current={activeSection === section.id ? "page" : undefined}
          className={`nav-link${activeSection === section.id ? " active" : ""}`}
          href={section.href}
          key={section.id}
        >
          <span aria-hidden="true">{section.id === "overview" ? "⌂" : section.id === "products" ? "◇" : section.id === "inventory" ? "▤" : section.id === "customers" ? "○" : section.id === "suppliers" ? "⇄" : section.id === "purchasing" ? "↗" : section.id === "pos" ? "$" : section.id === "promotions" ? "%" : section.id === "gift-cards" ? "◇" : section.id === "register-shifts" ? "▣" : section.id === "team" ? "♙" : section.id === "stores" ? "⌖" : section.id === "audit-logs" ? "≡" : "▥"}</span>
          {section.label}
        </a>
      ))}
    </nav>
  );

  return (
    <WorkspaceMutationContext organizationId={organizationId}>
      <main className="workspace">
        <aside className="workspace-sidebar">
          <a className="brand-lockup" href="/dashboard">
            <span className="brand-symbol">K</span>
            <span>Keta<span className="brand-light">Retail</span></span>
          </a>
          <div className="store-switcher">
            <span className="store-avatar">{organizationName.slice(0, 1).toUpperCase()}</span>
            <span><strong>{organizationName}</strong><small>{storeName}</small></span>
          </div>
          <OrganizationSwitcher
            organizations={organizations.map(({ organizationId: id, organization }) => ({ id, name: organization.name }))}
            selectedOrganizationId={organizationId}
          />
          <StoreSwitcher stores={stores} selectedStoreId={storeId} />
          <RegisterSwitcher registers={registers} selectedRegisterId={selectedRegisterId} />
          {subscriptionIsReadOnly(subscription, now) && <p className="sidebar-subscription-notice">Subscription expired. Workspace changes are disabled. <a href="/subscription">View subscription</a></p>}
          <p className="sidebar-label">Workspace</p>
          <div className="desktop-workspace-nav">{navigation}</div>
          <details className="mobile-workspace-nav">
            <summary>Menu · {visibleSections.find((section) => section.id === activeSection)?.label}</summary>
            {navigation}
          </details>
          <div className="sidebar-bottom">
            <p>Signed in as <strong>{userName}</strong></p>
            <p>Access role <strong>{role.replaceAll("_", " ")}</strong></p>
            <p>Local currency <strong>{currency} · Ghana cedi</strong></p>
            <SignOutButton />
          </div>
        </aside>
        <section className="workspace-main">{children}</section>
      </main>
    </WorkspaceMutationContext>
  );
}
