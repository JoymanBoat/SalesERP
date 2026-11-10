"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  createStore,
  setStoreActive,
  updateStore,
  type StoreActionState,
} from "@/app/stores/actions";

const initialState: StoreActionState = { status: "idle", message: "" };

function StoreDetailsForm({
  store,
}: {
  store: { id: string; name: string; code: string; address: string | null };
}) {
  const [state, action, pending] = useActionState(updateStore, initialState);

  return (
    <form action={action} className="store-details-form">
      <input type="hidden" name="storeId" value={store.id} />
      <label>Store name
        <input name="name" defaultValue={store.name} required minLength={2} maxLength={120} />
      </label>
      <label>Store code
        <input name="code" defaultValue={store.code} required minLength={2} maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" />
      </label>
      <label>Address
        <input name="address" defaultValue={store.address ?? ""} maxLength={240} />
      </label>
      <button className="button-quiet" type="submit" disabled={pending}>{pending ? "Saving..." : "Save details"}</button>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
    </form>
  );
}

function StoreStatusForm({
  store,
}: {
  store: { id: string; name: string; active: boolean };
}) {
  const [state, action, pending] = useActionState(setStoreActive, initialState);

  return (
    <form action={action} className="store-status-form">
      <input type="hidden" name="storeId" value={store.id} />
      <input type="hidden" name="active" value={String(!store.active)} />
      <button className={`button-quiet${store.active ? " store-deactivate-button" : ""}`} type="submit" disabled={pending}>
        {pending ? "Saving..." : store.active ? "Deactivate store" : "Reactivate store"}
      </button>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
    </form>
  );
}

export function StoreManagement({
  stores,
}: {
  stores: Array<{
    id: string;
    name: string;
    code: string;
    address: string | null;
    active: boolean;
    createdAt: string;
  }>;
}) {
  const [state, action, pending] = useActionState(createStore, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <div className="store-management">
      <section className="data-panel">
        <div className="panel-title-row">
          <div><h2>Add a store</h2><p>New stores start with zero on-hand quantity for tracked products.</p></div>
        </div>
        <form action={action} className="store-create-form" ref={formRef}>
          <label>Store name
            <input name="name" required minLength={2} maxLength={120} placeholder="e.g. Osu Branch" />
          </label>
          <label>Store code
            <input name="code" required minLength={2} maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" placeholder="e.g. OSU" />
          </label>
          <label>Address <span className="field-hint">Optional</span>
            <input name="address" maxLength={240} placeholder="Street, town, region" />
          </label>
          {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
          <button className="button-primary" type="submit" disabled={pending}>{pending ? "Creating store..." : "Create store"}</button>
        </form>
      </section>

      <section className="data-panel store-directory-panel" aria-labelledby="store-directory-heading">
        <div className="panel-title-row">
          <div><h2 id="store-directory-heading">Organization stores</h2><p>Deactivation preserves historical sales, stock, and register records.</p></div>
          <span className="table-count">{stores.length} stores</span>
        </div>
        <div className="store-directory">
          {stores.map((store) => (
            <article className="store-card" key={store.id}>
              <div className="store-card-heading">
                <div><h3>{store.name}</h3><span>{store.code} · Created {store.createdAt}</span></div>
                <span className={`order-status ${store.active ? "order-status-paid" : "order-status-cancelled"}`}>{store.active ? "ACTIVE" : "INACTIVE"}</span>
              </div>
              <StoreDetailsForm store={store} />
              <StoreStatusForm store={store} />
            </article>
          ))}
          {stores.length === 0 && <p className="report-empty">No stores were found for this organization.</p>}
        </div>
      </section>
      <p className="team-security-note">At least one store must remain active. Close a store’s register shift before deactivating it. Store codes are unique within the organization.</p>
    </div>
  );
}
