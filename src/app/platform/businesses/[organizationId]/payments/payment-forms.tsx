"use client";

import { useActionState, useState } from "react";

import { activateSubscription, recordSubscriptionPayment, voidSubscriptionPayment, type PaymentActionState } from "./actions";

const initialState: PaymentActionState = { status: "idle", message: "" };

export function PaymentForm({ organizationId, packages }: { organizationId: string; packages: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(recordSubscriptionPayment, initialState);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [packageId, setPackageId] = useState("");
  const [billingPeriod, setBillingPeriod] = useState("");

  return (
    <form action={action} className="platform-package-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="platform-package-fields platform-payment-fields">
        <label>Package<select name="packageId" required value={packageId} onChange={(event) => setPackageId(event.target.value)}><option value="" disabled>Select package</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Billing period<select name="billingPeriod" required value={billingPeriod} onChange={(event) => setBillingPeriod(event.target.value)}><option value="" disabled>Select period</option><option value="MONTHLY">Monthly</option><option value="ANNUAL">Annual</option></select></label>
        <label>Amount received (GHS)<input name="amount" type="number" min="0.01" max="9999999999.99" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>Date received (UTC)<input name="paidOn" type="date" required value={paidOn} onChange={(event) => setPaidOn(event.target.value)} /></label>
        <label>Payment reference<input name="reference" type="text" maxLength={100} required value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      </div>
      <p className="platform-package-hint">Only record payments received outside this application. The reference must be unique for this business. Saving does not activate a subscription or collect money.</p>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="platform-save-button" type="submit" disabled={pending || packages.length === 0}>{pending ? "Recording..." : "Record payment"}</button>
    </form>
  );
}

export function VoidPaymentForm({ organizationId, paymentId }: { organizationId: string; paymentId: string }) {
  const [state, action, pending] = useActionState(voidSubscriptionPayment, initialState);
  const [reason, setReason] = useState("");
  return (
    <details className="platform-audit-details">
      <summary>Void record</summary>
      <form action={action} className="platform-void-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="paymentId" value={paymentId} />
        <label>Reason for voiding<input name="reason" minLength={5} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <small>Voiding changes the record only. It does not refund money.</small>
        {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
        <button type="submit" disabled={pending}>{pending ? "Voiding..." : "Confirm void"}</button>
      </form>
    </details>
  );
}

export function TrialActivationForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(activateSubscription, initialState);
  return (
    <form action={action} className="platform-package-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="kind" value="TRIAL" />
      <p className="platform-package-hint">Starts a one-time 30-day trial with all currently available features. It cannot be restarted after expiry.</p>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="platform-save-button" type="submit" disabled={pending}>{pending ? "Starting..." : "Start 30-day trial"}</button>
    </form>
  );
}

export function PaidSubscriptionActivationForm({
  organizationId,
  payments,
}: {
  organizationId: string;
  payments: { id: string; packageName: string; billingPeriod: "MONTHLY" | "ANNUAL"; amount: string; currency: string; reference: string }[];
}) {
  const [state, action, pending] = useActionState(activateSubscription, initialState);
  const [paymentId, setPaymentId] = useState("");
  return (
    <form action={action} className="platform-package-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="kind" value="PAID" />
      <label className="platform-package-fields platform-activation-select">Recorded payment
        <select name="paymentId" required value={paymentId} onChange={(event) => setPaymentId(event.target.value)} disabled={payments.length === 0}>
          <option value="" disabled>Select an unused payment</option>
          {payments.map((payment) => (
            <option value={payment.id} key={payment.id}>
              {payment.packageName} · {payment.billingPeriod === "MONTHLY" ? "Monthly" : "Annual"} · {payment.currency} {payment.amount} · {payment.reference}
            </option>
          ))}
        </select>
      </label>
      <p className="platform-package-hint">{payments.length === 0
        ? "Record a payment first. Only unused, non-voided payments for this business can activate a plan."
        : "Activating requires a non-voided payment recorded for this business. Each payment can activate a plan only once. The plan applies immediately; its term starts now or extends from the current expiry."}</p>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="platform-save-button" type="submit" disabled={pending || payments.length === 0}>{pending ? "Activating..." : "Activate paid plan"}</button>
    </form>
  );
}
