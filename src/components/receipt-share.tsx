"use client";

import { useActionState, useState } from "react";

import { prepareReceiptShare, type ShareReceiptState } from "@/app/pos/receipt/actions";
import { normalizeReceiptPhone } from "@/lib/receipt-phone";

const initialState: ShareReceiptState = { status: "idle", message: "" };

export function ReceiptShare({ orderId, customerPhone }: { orderId: string; customerPhone: string | null }) {
  const [state, action, pending] = useActionState(prepareReceiptShare, initialState);
  const [phone, setPhone] = useState(customerPhone ?? "");
  const number = normalizeReceiptPhone(phone);
  const encoded = encodeURIComponent(state.text ?? "");

  return (
    <section className="data-panel receipt-share" aria-labelledby="share-receipt-heading">
      <h2 id="share-receipt-heading">Send a receipt <span className="optional-label">Optional</span></h2>
      <p>Ask for the customer&apos;s permission. Anyone with the link can view this receipt for 30 days. The message opens on your device for you to send.</p>
      <label>Customer phone number
        <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="e.g. 024 123 4567 or +233..." />
      </label>
      <form action={action}>
        <input type="hidden" name="orderId" value={orderId} />
        <button className="button-quiet" type="submit" disabled={pending || !number}>{pending ? "Preparing..." : "Prepare receipt link"}</button>
      </form>
      {phone && !number && <p className="form-error" role="alert">Enter a valid phone number, including the country code for numbers outside Ghana.</p>}
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      {number && state.text && (
        <div className="receipt-share-actions">
          <a className="button-quiet" href={`sms:+${number}?body=${encoded}`}>Open SMS</a>
          <a className="button-quiet" href={`https://wa.me/${number}?text=${encoded}`} target="_blank" rel="noopener noreferrer">Open WhatsApp</a>
        </div>
      )}
      <p>For customers outside your Wi-Fi, your administrator must configure a public HTTPS address. Do not send real customer data over local HTTP.</p>
    </section>
  );
}
