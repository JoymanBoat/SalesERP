"use client";

import { useActionState } from "react";

import { closeRegisterShift, openRegisterShift } from "@/app/register-shifts/actions";

const initialState = { status: "idle" as const, message: "" };

export function OpenRegisterShiftForm() {
  const [state, action, pending] = useActionState(openRegisterShift, initialState);

  return (
    <form action={action} className="record-form register-shift-form">
      <label>
        Opening cash float
        <input name="openingCash" type="number" min="0" max="99999999.99" step="0.01" defaultValue="0.00" required />
      </label>
      <label>
        Opening note <span className="optional-label">Optional</span>
        <input name="note" type="text" maxLength={160} placeholder="Till or handover note" />
      </label>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="button-primary" type="submit" disabled={pending}>{pending ? "Opening..." : "Open register shift"}</button>
    </form>
  );
}

export function CloseRegisterShiftForm({
  shiftId,
  openingCash,
}: {
  shiftId: string;
  openingCash: string;
}) {
  const [state, action, pending] = useActionState(closeRegisterShift, initialState);

  return (
    <form action={action} className="record-form register-shift-form">
      <input type="hidden" name="shiftId" value={shiftId} />
      <label>
        Closing cash counted
        <input name="closingCash" type="number" min="0" max="99999999.99" step="0.01" defaultValue={openingCash} required />
      </label>
      <label>
        Closing note <span className="optional-label">Optional</span>
        <input name="note" type="text" maxLength={160} placeholder="Handover or cash count note" />
      </label>
      <p className="register-shift-disclaimer">Expected cash includes the opening float plus completed cash sales, less refunds recorded during this shift.</p>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Closing..." : "Close register shift"}</button>
    </form>
  );
}
