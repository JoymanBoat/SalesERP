"use client";

import { useActionState, useEffect, useRef } from "react";

import { createSupplier } from "@/app/suppliers/actions";

const initialSupplierActionState = { status: "idle" as const, message: "" };

export function SupplierForm() {
  const [state, action, pending] = useActionState(createSupplier, initialSupplierActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form action={action} className="record-form" ref={formRef}>
      <label>Business name<input name="businessName" required minLength={2} maxLength={120} autoComplete="organization" /></label>
      <label>Contact person <span className="optional-label">Optional</span><input name="contactName" maxLength={100} autoComplete="name" /></label>
      <label>Email <span className="optional-label">Optional</span><input name="email" type="email" maxLength={254} autoComplete="email" /></label>
      <label>Phone <span className="optional-label">Optional</span><input name="phone" type="tel" maxLength={32} autoComplete="tel" /></label>
      <label>Address <span className="optional-label">Optional</span><input name="address" maxLength={240} autoComplete="street-address" /></label>
      <label>Notes <span className="optional-label">Optional</span><textarea name="notes" maxLength={500} rows={3} /></label>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="button-primary" type="submit" disabled={pending}>{pending ? "Saving supplier..." : "Add supplier"}</button>
    </form>
  );
}
