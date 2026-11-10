"use client";

import { switchActiveStore } from "@/app/stores/actions";

export function StoreSwitcher({
  stores,
  selectedStoreId,
}: {
  stores: Array<{ id: string; name: string; code: string }>;
  selectedStoreId: string;
}) {
  if (stores.length <= 1) return null;

  return (
    <form action={switchActiveStore} className="store-switcher-form">
      <label htmlFor="active-store">Active store</label>
      <select
        id="active-store"
        name="storeId"
        defaultValue={selectedStoreId}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {stores.map((store) => (
          <option value={store.id} key={store.id}>{store.name} · {store.code}</option>
        ))}
      </select>
    </form>
  );
}
