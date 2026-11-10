"use client";

import { useActionState, useEffect, useRef } from "react";

import { createProductOption } from "@/app/products/actions";

const initialState = { status: "idle" as const, message: "" };

export function ProductOptionsManager({ options }: { options: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(createProductOption, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <section className="data-panel product-options-panel">
      <div className="panel-title-row">
        <div><h2>Reusable variant options</h2><p>Create attributes once, then use them on variants across your catalog.</p></div>
        <span className="table-count">{options.length} options</span>
      </div>
      <div className="product-options-layout">
        <div className="product-options-list">
          {options.map((option) => (
            <span className="product-option-chip" key={option.id}>{option.name.replace(/^./, (letter) => letter.toLocaleUpperCase())}</span>
          ))}
          {options.length === 0 && <span className="table-secondary">No reusable options yet. Add one such as Size, Colour, or Material.</span>}
        </div>
        <form action={action} className="product-option-form" ref={formRef}>
          <label htmlFor="product-option-name">Option name</label>
          <input id="product-option-name" name="name" required maxLength={40} placeholder="e.g. Size" />
          <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Adding..." : "Add option"}</button>
          {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
        </form>
      </div>
    </section>
  );
}
