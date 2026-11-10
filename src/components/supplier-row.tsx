"use client";

import { useActionState } from "react";

import { setSupplierActive, updateSupplier } from "@/app/suppliers/actions";

const idleState = { status: "idle" as const, message: "" };

export function SupplierRow({
  supplier,
  canManage,
  showInactive,
}: {
  supplier: {
    id: string;
    businessName: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    notes: string | null;
  };
  canManage: boolean;
  showInactive: boolean;
}) {
  const [updateState, updateAction, updatePending] = useActionState(updateSupplier, idleState);
  const [statusState, statusAction, statusPending] = useActionState(setSupplierActive, idleState);

  return (
    <tr>
      <td>
        <strong>{supplier.businessName}</strong>
        {supplier.contactName && <small className="table-secondary">Contact · {supplier.contactName}</small>}
        {supplier.notes && <small className="table-secondary supplier-notes">{supplier.notes}</small>}
        {canManage && !showInactive && (
          <details className="supplier-edit">
            <summary>Edit details</summary>
            <form action={updateAction} className="supplier-edit-form">
              <input type="hidden" name="supplierId" value={supplier.id} />
              <label>Business name<input name="businessName" required minLength={2} maxLength={120} defaultValue={supplier.businessName} /></label>
              <label>Contact person<input name="contactName" maxLength={100} defaultValue={supplier.contactName ?? ""} /></label>
              <label>Email<input name="email" type="email" maxLength={254} defaultValue={supplier.email ?? ""} /></label>
              <label>Phone<input name="phone" type="tel" maxLength={32} defaultValue={supplier.phone ?? ""} /></label>
              <label>Address<input name="address" maxLength={240} defaultValue={supplier.address ?? ""} /></label>
              <label>Notes<textarea name="notes" maxLength={500} rows={2} defaultValue={supplier.notes ?? ""} /></label>
              {updateState.message && (
                <p className={updateState.status === "error" ? "inline-error" : "inline-success"} role={updateState.status === "error" ? "alert" : "status"}>
                  {updateState.message}
                </p>
              )}
              <button className="button-quiet" type="submit" disabled={updatePending}>
                {updatePending ? "Saving..." : "Save changes"}
              </button>
            </form>
          </details>
        )}
      </td>
      <td>{supplier.email ?? supplier.phone ?? "—"}{supplier.email && supplier.phone && <small className="table-secondary">{supplier.phone}</small>}</td>
      <td>{supplier.address ?? "—"}</td>
      {canManage && (
        <td>
          <form action={statusAction} className="supplier-status-form">
            <input type="hidden" name="supplierId" value={supplier.id} />
            <input type="hidden" name="active" value={showInactive ? "true" : "false"} />
            <button type="submit" className="product-status-button" disabled={statusPending}>
              {statusPending ? "Updating..." : showInactive ? "Reactivate" : "Deactivate"}
            </button>
            {statusState.message && <small className="inline-error" role="alert">{statusState.message}</small>}
          </form>
        </td>
      )}
    </tr>
  );
}
