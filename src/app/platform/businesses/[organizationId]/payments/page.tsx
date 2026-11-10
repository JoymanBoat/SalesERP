import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { prisma } from "@/lib/prisma";

import { PlatformShell } from "../../../platform-shell";
import { PaidSubscriptionActivationForm, PaymentForm, TrialActivationForm, VoidPaymentForm } from "./payment-forms";

export const dynamic = "force-dynamic";

export default async function SubscriptionPaymentsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const session = await requirePlatformAdmin();
  const id = z.string().cuid().safeParse((await params).organizationId);
  if (!id.success) notFound();
  const organization = await prisma.organization.findUnique({
    where: { id: id.data },
    select: { id: true, name: true, timezone: true, subscription: { include: { package: { select: { name: true } } } } },
  });
  if (!organization) notFound();
  const [packages, payments, activatablePayments] = await Promise.all([
    prisma.subscriptionPackage.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.subscriptionPayment.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, packageName: true, billingPeriod: true, amount: true, currency: true, paidOn: true, createdAt: true, reference: true, voidedAt: true, voidReason: true, activatedAt: true, activatedBy: { select: { user: { select: { email: true } } } }, recordedBy: { select: { user: { select: { email: true } } } }, voidedBy: { select: { user: { select: { email: true } } } } },
      take: 100,
    }),
    prisma.subscriptionPayment.findMany({
      where: { organizationId: organization.id, voidedAt: null, activatedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, packageName: true, billingPeriod: true, amount: true, currency: true, reference: true },
      take: 100,
    }),
  ]);
  await prisma.platformAuditEvent.create({ data: { actorId: session.user.id, organizationId: organization.id, action: "subscription_payments.viewed" } });

  return (
    <PlatformShell active="businesses">
      <Link href={`/platform/businesses/${organization.id}`} className="platform-back"><ArrowLeft size={16} aria-hidden="true" /> Business records</Link>
      <header className="platform-header"><div><p className="platform-eyebrow">SUBSCRIPTIONS</p><h1>Payment records</h1><p>{organization.name}</p></div></header>
      <section className="platform-panel" aria-labelledby="subscription-status">
        <div className="platform-panel-heading"><div><p className="platform-eyebrow">CURRENT ACCESS</p><h2 id="subscription-status">Subscription status</h2></div></div>
        <div className="platform-subscription-summary">
          {!organization.subscription ? <><strong>Legacy access</strong><p>This business has no assigned subscription; its existing access remains unrestricted.</p></> : (
            <>
              <strong>{organization.subscription.kind === "TRIAL" ? "Trial" : organization.subscription.package?.name ?? "Paid plan"} · {organization.subscription.expiresAt > new Date() ? "Active" : "Expired"}</strong>
              <p>Access expires {new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: organization.timezone }).format(organization.subscription.expiresAt)}.</p>
            </>
          )}
        </div>
        <div className="platform-detail-grid">
          {!organization.subscription && <section className="platform-panel"><div className="platform-panel-heading"><div><h3>Start a trial</h3></div></div><TrialActivationForm organizationId={organization.id} /></section>}
          <section className="platform-panel"><div className="platform-panel-heading"><div><h3>Activate or renew a paid plan</h3><p>Choose an unused payment already recorded below.</p></div></div>
            <PaidSubscriptionActivationForm organizationId={organization.id} payments={activatablePayments.map((payment) => ({
              ...payment,
              amount: payment.amount.toFixed(2),
            }))} />
          </section>
        </div>
      </section>
      <div className="platform-package-notice" role="note"><strong>Manual payment confirmation</strong><p>Record only money received outside the app. Activating a paid plan requires an unused, non-voided payment for this business; the app does not collect or verify funds. Trial access lasts 30 days. Paid billing terms use calendar months or years, and a renewal extends from the current expiry.</p></div>
      <section className="platform-panel" aria-labelledby="record-payment">
        <div className="platform-panel-heading"><div><p className="platform-eyebrow">MANUAL ENTRY</p><h2 id="record-payment">Record a payment</h2></div></div>
        <PaymentForm organizationId={organization.id} packages={packages} />
      </section>
      <section className="platform-panel" aria-labelledby="payment-history">
        <div className="platform-panel-heading"><div><p className="platform-eyebrow">HISTORY</p><h2 id="payment-history">Recorded payments</h2><p>Showing the most recent 100 records, including voided entries.</p></div><span className="platform-count">{payments.length} shown</span></div>
        {payments.length === 0 ? <p className="platform-empty">No payments recorded.</p> : <div className="platform-table-scroll"><table className="platform-table">
          <thead><tr><th scope="col">Date received (UTC)</th><th scope="col">Package</th><th scope="col">Period</th><th scope="col">Amount</th><th scope="col">Reference</th><th scope="col">Recorded by</th><th scope="col">Recorded at (UTC)</th><th scope="col">Status</th></tr></thead>
          <tbody>{payments.map((payment) => <tr key={payment.id}><td>{payment.paidOn.toISOString().slice(0, 10)}</td><td>{payment.packageName}</td><td>{payment.billingPeriod === "MONTHLY" ? "Monthly" : "Annual"}</td><td>{payment.currency} {payment.amount.toFixed(2)}</td><td>{payment.reference}</td><td>{payment.recordedBy.user.email}</td><td>{payment.createdAt.toISOString()}</td><td>{payment.voidedAt ? <div className="platform-voided"><strong>Voided</strong><span>By {payment.voidedBy?.user.email} on {payment.voidedAt.toISOString()}</span><span>Reason: {payment.voidReason}</span></div> : payment.activatedAt ? <div className="platform-voided"><strong>Activated</strong><span>By {payment.activatedBy?.user.email} on {payment.activatedAt.toISOString()}</span></div> : <VoidPaymentForm organizationId={organization.id} paymentId={payment.id} />}</td></tr>)}</tbody>
        </table></div>}
      </section>
    </PlatformShell>
  );
}
