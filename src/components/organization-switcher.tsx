"use client";

import { switchActiveOrganization } from "@/app/workspaces/actions";

export function OrganizationSwitcher({
  organizations,
  selectedOrganizationId,
}: {
  organizations: Array<{ id: string; name: string }>;
  selectedOrganizationId: string;
}) {
  if (organizations.length <= 1) return null;

  return (
    <form action={switchActiveOrganization} className="store-switcher-form">
      <label htmlFor="active-organization">Business</label>
      <select
        id="active-organization"
        name="organizationId"
        defaultValue={selectedOrganizationId}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {organizations.map((organization) => (
          <option value={organization.id} key={organization.id}>{organization.name}</option>
        ))}
      </select>
    </form>
  );
}
