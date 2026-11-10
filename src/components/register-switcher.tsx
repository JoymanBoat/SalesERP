"use client";

import { switchActiveRegister } from "@/app/registers/actions";

export function RegisterSwitcher({
  registers,
  selectedRegisterId,
}: {
  registers: Array<{ id: string; name: string; code: string }>;
  selectedRegisterId: string | null;
}) {
  if (registers.length <= 1 || !selectedRegisterId) return null;

  return (
    <form action={switchActiveRegister} className="store-switcher-form">
      <label htmlFor="active-register">Active POS register</label>
      <select
        id="active-register"
        name="registerId"
        defaultValue={selectedRegisterId}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {registers.map((register) => (
          <option value={register.id} key={register.id}>{register.name} · {register.code}</option>
        ))}
      </select>
    </form>
  );
}
