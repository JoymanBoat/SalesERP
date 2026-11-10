import { requirePlatformAdmin } from "@/lib/platform-admin";
import { prisma } from "@/lib/prisma";

import { PlatformShell } from "../platform-shell";
import { PackageForm } from "./package-form";

export const dynamic = "force-dynamic";

export default async function PlatformPackagesPage() {
  const session = await requirePlatformAdmin();
  const packages = await prisma.subscriptionPackage.findMany({ orderBy: { name: "asc" } });
  await prisma.platformAuditEvent.create({ data: { actorId: session.user.id, action: "subscription_packages.viewed" } });

  return (
    <PlatformShell active="packages">
      <header className="platform-header">
        <div><p className="platform-eyebrow">SUBSCRIPTIONS</p><h1>Packages</h1><p>Configure the features, prices and limits for each package.</p></div>
      </header>
      <div className="platform-package-notice" role="note"><strong>Active subscriptions use these settings</strong><p>Feature and capacity changes apply immediately to businesses on each paid package. Trial activation and paid-plan activation are managed from a business&apos;s subscription records. Payment entries remain manual and do not activate access by themselves.</p></div>
      <div className="platform-package-grid">
        {packages.map((item) => <section className="platform-panel" key={item.id}>
          <div className="platform-panel-heading"><div><p className="platform-eyebrow">PACKAGE</p><h2>{item.name}</h2><p>Prices are provisional until you set them.</p></div></div>
          <PackageForm key={`${item.id}-${item.revision}`} packageInfo={{
            id: item.id, name: item.name, revision: item.revision,
            features: item.features, maxStores: item.maxStores, maxStaff: item.maxStaff,
            monthlyPrice: item.monthlyPrice?.toFixed(2) ?? null, annualPrice: item.annualPrice?.toFixed(2) ?? null,
          }} />
        </section>)}
      </div>
    </PlatformShell>
  );
}
