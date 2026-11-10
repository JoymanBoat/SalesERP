"use client";

import { useActionState, useEffect, useRef } from "react";

import { importProducts } from "@/app/products/actions";

const initialState = { status: "idle" as const, message: "" };

export function ProductImportForm() {
  const [state, action, pending] = useActionState(importProducts, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form action={action} className="record-form product-import-form" ref={formRef}>
      <label>
        CSV file
        <input name="file" type="file" accept=".csv,text/csv" required />
      </label>
      <p className="form-intro">Up to 50 new products per file (1 MB max). Imports are all-or-nothing; duplicate SKUs are rejected.</p>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Importing products..." : "Import CSV"}</button>
    </form>
  );
}
