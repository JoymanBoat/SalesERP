import { WorkspaceShell } from "@/components/workspace-shell";
import { SUBSCRIPTION_FEATURES, subscriptionIsReadOnly, type SubscriptionFeature } from "@/lib/subscription-policy";
import { getWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const featureLabels: Record<SubscriptionFeature, string> = {
  pos: "Point of sale",
  inventory: "Products and inventory",
  customers: "Customers",
  suppliers: "Suppliers",
  purchasing: "Purchasing",
  reports: "Reports",
  promotions: "Promotions",
  giftCards: "Gift cards",
};

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; feature?: string }>;
}) {
  const { session, membership, organization, store, subscription } = await getWorkspace({ operation: "view" });
  const { reason, feature } = await searchParams;
  const readOnly = subscriptionIsReadOnly(subscription, new Date());
  const requestedFeature = SUBSCRIPTION_FEATURES.find((item) => item === feature);
  const expiry = subscription.kind === "legacy" ? null : new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: organization.timezone,
  }).format(subscription.expiresAt);
  const planName = subscription.kind === "legacy" ? "Legacy access" : subscription.kind === "trial" ? "30-day trial" : subscription.package.name;

  return (
    <WorkspaceShell
      activeSection="subscription"
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
        <div><p className="breadcrumbs">Workspace / Subscription</p><h1>Subscription access</h1><p className="header-note">Review your business plan and access status.</p></div>
      </header>
      {reason === "expired" && <p className="form-error subscription-access-notice" role="alert">This subscription has expired. Your business data remains available in read-only mode. Contact the platform administrator to renew access.</p>}
      {reason === "feature" && <p className="form-error subscription-access-notice" role="alert">
        {requestedFeature
          ? `${featureLabels[requestedFeature]} is not included in the current plan. Contact the platform administrator to change your plan.`
          : "This feature is not available on the current plan. Contact the platform administrator to change your plan."}
      </p>}
      <section className="data-panel subscription-access-panel" aria-labelledby="subscription-summary-heading">
        <div className="panel-title-row"><div><p className="eyebrow">CURRENT PLAN</p><h2 id="subscription-summary-heading">{planName}</h2></div><span className={readOnly ? "order-status is-muted" : "order-status"}>{readOnly ? "Expired · read-only" : "Active"}</span></div>
        <dl className="subscription-access-details">
          <div><dt>Business</dt><dd>{organization.name}</dd></div>
          <div><dt>Plan</dt><dd>{planName}</dd></div>
          {expiry && <div><dt>Access expires</dt><dd>{expiry}</dd></div>}
          {subscription.kind === "paid" && <div><dt>Features</dt><dd>{subscription.package.features.map((item) => featureLabels[item]).join(", ") || "No optional features enabled"}</dd></div>}
        </dl>
        <p className="subscription-access-help">For plan changes, renewals, or billing questions, contact your platform administrator. The application does not collect subscription payments.</p>
      </section>
    </WorkspaceShell>
  );
}
