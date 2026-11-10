"use client";

import { useActionState, useEffect, useRef } from "react";

import { createCustomer } from "@/app/customers/actions";

const initialCustomerActionState = { status: "idle" as const, message: "" };

export function CustomerForm() {
  const [state, action, pending] = useActionState(createCustomer, initialCustomerActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form action={action} className="record-form" ref={formRef}>
      <label>First name<input name="firstName" required minLength={2} maxLength={80} autoComplete="given-name" /></label>
      <label>Last name <span className="optional-label">Optional</span><input name="lastName" maxLength={80} autoComplete="family-name" /></label>
      <label>Email <span className="optional-label">Optional</span><input name="email" type="email" maxLength={254} autoComplete="email" /></label>
      <label>Phone <span className="optional-label">Optional</span><input name="phone" type="tel" maxLength={32} autoComplete="tel" /></label>
      <label>Notes <span className="optional-label">Optional</span><textarea name="notes" maxLength={500} rows={3} /></label>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="button-primary" type="submit" disabled={pending}>{pending ? "Saving customer..." : "Add customer"}</button>
    </form>
  );
}
