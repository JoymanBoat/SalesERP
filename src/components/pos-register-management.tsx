"use client";

import { useActionState } from "react";

import {
  createPosRegister,
  setPosRegisterActive,
  updatePosRegister,
} from "@/app/registers/actions";

const initialState = { status: "idle" as const, message: "" };

function RegisterStatusForm({ registerId, active }: { registerId: string; active: boolean }) {
  const [state, action, pending] = useActionState(setPosRegisterActive, initialState);
  return (
    <form action={action} className="team-remove-form" onSubmit={(event) => {
      if (active && !window.confirm("Deactivate this POS register? It cannot be used for new shifts or sales.")) event.preventDefault();
    }}>
      <input type="hidden" name="registerId" value={registerId} />
      <input type="hidden" name="active" value={String(!active)} />
      <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Saving..." : active ? "Deactivate" : "Reactivate"}</button>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
    </form>
  );
}

function RegisterDetailsForm({ registerId, name, code }: { registerId: string; name: string; code: string }) {
  const [state, action, pending] = useActionState(updatePosRegister, initialState);
  return (
    <form action={action} className="team-role-form">
      <input type="hidden" name="registerId" value={registerId} />
      <label>Register name<input name="name" defaultValue={name} minLength={2} maxLength={80} required /></label>
      <label>Register code<input name="code" defaultValue={code} minLength={2} maxLength={16} required /></label>
      <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Saving..." : "Save register"}</button>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
    </form>
  );
}

export function PosRegisterManagement({
  registers,
}: {
  registers: Array<{
    id: string;
    name: string;
    code: string;
    active: boolean;
    openShift: boolean;
  }>;
}) {
  const [createState, createAction, creating] = useActionState(createPosRegister, initialState);

  return (
    <div className="team-management">
      <section className="data-panel team-add-panel">
        <div className="panel-title-row"><div><h2>Add POS register</h2><p>Create a named station for this store. Employees need explicit station access to operate it.</p></div></div>
        <form action={createAction} className="team-add-form">
          <label>Register name<input name="name" minLength={2} maxLength={80} required placeholder="Front counter" /></label>
          <label>Register code<input name="code" minLength={2} maxLength={16} required placeholder="FRONT" /></label>
          {createState.message && <p className={createState.status === "error" ? "form-error" : "form-success"} role={createState.status === "error" ? "alert" : "status"}>{createState.message}</p>}
          <button className="button-primary" type="submit" disabled={creating}>{creating ? "Creating..." : "Create POS register"}</button>
        </form>
      </section>

      <section className="data-panel team-directory-panel" aria-labelledby="pos-register-directory">
        <div className="panel-title-row"><div><h2 id="pos-register-directory">Registers at this store</h2><p>Each register has its own shift and cash reconciliation.</p></div><span className="table-count">{registers.filter(({ active }) => active).length} active</span></div>
        <div className="team-directory">
          {registers.map((register) => (
            <article className="team-member-card" key={register.id}>
              <div className="team-member-identity">
                <span className="team-member-avatar" aria-hidden="true">R</span>
                <div><strong>{register.name}</strong><span>{register.code}</span><small>{register.openShift ? "Open shift" : "No open shift"} · {register.active ? "Active" : "Inactive"}</small></div>
              </div>
              <div className="team-member-access">
                <RegisterDetailsForm registerId={register.id} name={register.name} code={register.code} />
                <RegisterStatusForm registerId={register.id} active={register.active} />
              </div>
            </article>
          ))}
          {registers.length === 0 && <p className="report-empty">No POS registers exist for this store.</p>}
        </div>
      </section>
      <p className="team-security-note">Deactivated registers cannot be selected, opened, or used for POS actions. A register with an open shift cannot be deactivated, and each store must retain at least one active register.</p>
    </div>
  );
}
