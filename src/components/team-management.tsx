"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  addOrganizationMember,
  inviteOrganizationMember,
  removeOrganizationMember,
  updateOrganizationMemberRegisters,
  updateOrganizationMemberStores,
  updateOrganizationMemberRole,
} from "@/app/team/actions";

const initialState = { status: "idle" as const, message: "" };

const employeeRoles = [
  ["MANAGER", "Manager"],
  ["CASHIER", "Cashier"],
  ["INVENTORY_MANAGER", "Inventory manager"],
  ["ACCOUNTANT", "Accountant"],
  ["CUSTOMER_SUPPORT", "Customer support"],
] as const;

function RoleForm({
  membershipId,
  role,
}: {
  membershipId: string;
  role: string;
}) {
  const [state, action, pending] = useActionState(updateOrganizationMemberRole, initialState);

  return (
    <form action={action} className="team-role-form">
      <input type="hidden" name="membershipId" value={membershipId} />
      <label className="visually-hidden" htmlFor={`team-role-${membershipId}`}>Employee role</label>
      <select id={`team-role-${membershipId}`} name="role" defaultValue={role}>
        {employeeRoles.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
      <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Saving..." : "Update role"}</button>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
    </form>
  );
}

function RemoveMemberForm({
  membershipId,
  email,
}: {
  membershipId: string;
  email: string;
}) {
  const [state, action, pending] = useActionState(removeOrganizationMember, initialState);

  return (
    <form action={action} className="team-remove-form" onSubmit={(event) => {
      if (!window.confirm(`Remove ${email}'s access to this organization?`)) event.preventDefault();
    }}>
      <input type="hidden" name="membershipId" value={membershipId} />
      <button className="button-quiet team-remove-button" type="submit" disabled={pending}>{pending ? "Removing..." : "Remove access"}</button>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
    </form>
  );
}

function StoreAssignmentForm({
  membershipId,
  assignedStoreIds,
  stores,
}: {
  membershipId: string;
  assignedStoreIds: string[];
  stores: Array<{ id: string; name: string; code: string }>;
}) {
  const [state, action, pending] = useActionState(updateOrganizationMemberStores, initialState);

  return (
    <form action={action} className="team-store-assignment-form">
      <input type="hidden" name="membershipId" value={membershipId} />
      <fieldset>
        <legend>Assigned stores</legend>
        {stores.map((store) => (
          <label key={store.id}>
            <input
              type="checkbox"
              name="storeIds"
              value={store.id}
              defaultChecked={assignedStoreIds.includes(store.id)}
            />
            {store.name} <span>{store.code}</span>
          </label>
        ))}
      </fieldset>
      <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Saving..." : "Save store access"}</button>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
    </form>
  );
}

function RegisterAssignmentForm({
  membershipId,
  assignedRegisterIds,
  registers,
}: {
  membershipId: string;
  assignedRegisterIds: string[];
  registers: Array<{ id: string; name: string; code: string; storeId: string; storeName: string }>;
}) {
  const [state, action, pending] = useActionState(updateOrganizationMemberRegisters, initialState);

  return (
    <form action={action} className="team-store-assignment-form">
      <input type="hidden" name="membershipId" value={membershipId} />
      <fieldset>
        <legend>Assigned POS registers</legend>
        {registers.map((register) => (
          <label key={register.id}>
            <input
              type="checkbox"
              name="registerIds"
              value={register.id}
              defaultChecked={assignedRegisterIds.includes(register.id)}
            />
            {register.name} <span>{register.storeName} · {register.code}</span>
          </label>
        ))}
        {registers.length === 0 && <span>No active POS registers are available.</span>}
      </fieldset>
      <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Saving..." : "Save POS access"}</button>
      {state.message && <span className={state.status === "error" ? "inline-error" : "inline-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
    </form>
  );
}

export function TeamManagement({
  employees,
  currentMembershipId,
  stores,
  registers,
}: {
  employees: Array<{
    membershipId: string;
    name: string | null;
    email: string;
    role: string;
    joinedAt: string;
    assignedStoreIds: string[];
    assignedRegisterIds: string[];
  }>;
  currentMembershipId: string;
  stores: Array<{ id: string; name: string; code: string }>;
  registers: Array<{ id: string; name: string; code: string; storeId: string; store: { name: string } }>;
}) {
  const [state, action, pending] = useActionState(addOrganizationMember, initialState);
  const [invitationState, invitationAction, invitationPending] = useActionState(inviteOrganizationMember, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const invitationFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  useEffect(() => {
    if (invitationState.status === "success") invitationFormRef.current?.reset();
  }, [invitationState]);

  return (
    <div className="team-management">
      <section className="data-panel team-add-panel">
        <div className="panel-title-row">
          <div><h2>Invite a new employee</h2><p>We’ll email a secure invitation so they can create their account and accept the assigned access.</p></div>
        </div>
        <form action={invitationAction} className="team-add-form" ref={invitationFormRef}>
          <label>Email address
            <input name="email" type="email" maxLength={254} autoComplete="email" required placeholder="employee@example.com" />
          </label>
          <label>Role
            <select name="role" defaultValue="CASHIER">
              {employeeRoles.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <fieldset className="team-add-stores">
            <legend>Store access</legend>
            {stores.map((store) => (
              <label key={store.id}>
                <input type="checkbox" name="storeIds" value={store.id} defaultChecked={stores.length === 1} />
                {store.name} <span>{store.code}</span>
              </label>
            ))}
            {stores.length === 0 && <span>No active stores are available.</span>}
          </fieldset>
          <fieldset className="team-add-stores">
            <legend>POS register access</legend>
            {registers.map((register) => (
              <label key={register.id}>
                <input type="checkbox" name="registerIds" value={register.id} />
                {register.name} <span>{register.store.name} · {register.code}</span>
              </label>
            ))}
            {registers.length === 0 && <span>No active POS registers are available.</span>}
            <small>Only selected registers can be used for POS checkout and shift operations.</small>
          </fieldset>
          {invitationState.message && <p className={invitationState.status === "error" ? "form-error" : "form-success"} role={invitationState.status === "error" ? "alert" : "status"}>{invitationState.message}</p>}
          <button className="button-primary" type="submit" disabled={invitationPending || stores.length === 0}>{invitationPending ? "Sending invitation..." : "Send employee invitation"}</button>
        </form>
      </section>

      <section className="data-panel team-add-panel">
        <div className="panel-title-row">
          <div><h2>Add employee access</h2><p>The person must first create an account with this email address.</p></div>
        </div>
        <form action={action} className="team-add-form" ref={formRef}>
          <label>Email address
            <input name="email" type="email" maxLength={254} autoComplete="email" required placeholder="employee@example.com" />
          </label>
          <label>Role
            <select name="role" defaultValue="CASHIER">
              {employeeRoles.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <fieldset className="team-add-stores">
            <legend>Store access</legend>
            {stores.map((store) => (
              <label key={store.id}>
                <input type="checkbox" name="storeIds" value={store.id} defaultChecked={stores.length === 1} />
                {store.name} <span>{store.code}</span>
              </label>
            ))}
            {stores.length === 0 && <span>No active stores are available.</span>}
          </fieldset>
          <fieldset className="team-add-stores">
            <legend>POS register access</legend>
            {registers.map((register) => (
              <label key={register.id}>
                <input type="checkbox" name="registerIds" value={register.id} />
                {register.name} <span>{register.store.name} · {register.code}</span>
              </label>
            ))}
            {registers.length === 0 && <span>No active POS registers are available.</span>}
            <small>Only selected registers can be used for POS checkout and shift operations.</small>
          </fieldset>
          {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
          <button className="button-primary" type="submit" disabled={pending || stores.length === 0}>{pending ? "Adding employee..." : "Grant organization access"}</button>
        </form>
      </section>

      <section className="data-panel team-directory-panel" aria-labelledby="team-directory-heading">
        <div className="panel-title-row">
          <div><h2 id="team-directory-heading">Organization employees</h2><p>Role changes affect organization access immediately.</p></div>
          <span className="table-count">{employees.length} members</span>
        </div>
        <div className="team-directory">
          {employees.map((employee) => (
            <article className="team-member-card" key={employee.membershipId}>
              <div className="team-member-identity">
                <span className="team-member-avatar" aria-hidden="true">{(employee.name ?? employee.email).slice(0, 1).toUpperCase()}</span>
                <div><strong>{employee.name ?? employee.email}</strong><span>{employee.email}</span><small>Joined {employee.joinedAt}{employee.membershipId === currentMembershipId ? " · You" : ""}</small></div>
              </div>
              <div className="team-member-access">
                {employee.role === "OWNER"
                  ? <span className="team-owner-badge">Owner</span>
                  : <>
                      <RoleForm membershipId={employee.membershipId} role={employee.role} />
                      <StoreAssignmentForm
                        membershipId={employee.membershipId}
                        assignedStoreIds={employee.assignedStoreIds}
                        stores={stores}
                      />
                      <RegisterAssignmentForm
                        membershipId={employee.membershipId}
                        assignedRegisterIds={employee.assignedRegisterIds}
                        registers={registers.map((register) => ({
                          ...register,
                          storeName: register.store.name,
                        }))}
                      />
                    </>}
                {employee.role !== "OWNER" && (
                  <RemoveMemberForm membershipId={employee.membershipId} email={employee.email} />
                )}
              </div>
            </article>
          ))}
          {employees.length === 0 && <p className="report-empty">No organization members were found.</p>}
        </div>
      </section>
      <p className="team-security-note">Invitation links expire after 72 hours and can be used once to create an account. Non-owner employees can access only their assigned active stores and POS registers. Removing organization access does not delete the person’s account or other organization memberships.</p>
    </div>
  );
}
