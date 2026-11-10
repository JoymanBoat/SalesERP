import { MembershipRole } from "@prisma/client";
import Link from "next/link";

import { CategoryManagement } from "@/components/category-management";
import { PosSettingsForm } from "@/components/pos-settings-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { businessDateInTimeZone } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { GRA_TAX_INFORMATION_URL, resolveTaxRatesAt, TAX_DISCLAIMER } from "@/lib/tax";
import { getWorkspace } from "@/lib/workspace";

export default async function SettingsPage() {
  const { session, membership, organization, store } = await getWorkspace({ allowedRoles: [MembershipRole.OWNER, MembershipRole.MANAGER], feature: "pos", operation: "view" });
  const [categories, taxHistoryRows] = await Promise.all([
    membership.role === MembershipRole.OWNER
      ? prisma.category.findMany({
          where: { organizationId: organization.id },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    prisma.taxRateSetting.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ effectiveFrom: "desc" }, { component: "asc" }],
      take: 60,
      select: { component: true, rate: true, effectiveFrom: true },
    }),
  ]);
  const businessDate = businessDateInTimeZone(new Date(), organization.timezone);
  const taxHistory = taxHistoryRows.map((entry) => ({
    component: entry.component,
    rate: entry.rate.toFixed(2),
    effectiveFrom: entry.effectiveFrom.toISOString().slice(0, 10),
  }));
  const taxRates = resolveTaxRatesAt(taxHistory, businessDate);

  return (
    <WorkspaceShell
      activeSection="settings"
      membershipId={membership.id}
      organizationId={organization.id}
      organizationName={organization.name}
      storeId={store.id}
      storeName={store.name}
      currency={organization.currency}
      userName={session.user.name ?? session.user.email ?? "User"}
      role={membership.role}
    >
      <header className="workspace-header">
        <div>
          <p className="breadcrumbs"><Link href="/dashboard">Workspace</Link> / Settings</p>
          <h1>Settings</h1>
          <p className="header-note">Configure your organization and product catalog.</p>
        </div>
      </header>
      <section id="tax-settings" className="data-panel pos-tax-panel">
        <div className="panel-title-row"><div><h2>Tax setup</h2><p>VAT, NHIL and GETFund are separate rates, each applied to the same discounted taxable base (not cascaded). New and updated held carts snapshot the rates in effect today; completed sales are unchanged. Rates default to 0%.</p></div></div>
        <PosSettingsForm rates={taxRates} today={businessDate} history={taxHistory} />
        <p className="register-shift-disclaimer">{TAX_DISCLAIMER} <a href={GRA_TAX_INFORMATION_URL} target="_blank" rel="noreferrer">GRA VAT information</a>. Product treatments (standard, zero-rated, exempt, relieved) are set on the product; only standard items are taxed.</p>
      </section>
      {membership.role === MembershipRole.OWNER && <CategoryManagement categories={categories} />}
      <footer className="workspace-footer"><span>{organization.name}</span><span>{store.name} · {organization.currency}</span></footer>
    </WorkspaceShell>
  );
}
