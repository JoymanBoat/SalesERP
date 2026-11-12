"use client";

import { useEffect, type ReactNode } from "react";

export function WorkspaceMutationContext({
  children,
  organizationId,
}: {
  children: ReactNode;
  organizationId: string;
}) {
  useEffect(() => {
    function bindOrganization(event: SubmitEvent) {
      if (!(event.target instanceof HTMLFormElement)) return;
      const workspace = event.target.closest<HTMLElement>("[data-workspace-organization-id]");
      const selectedOrganizationId = workspace?.dataset.workspaceOrganizationId;
      if (!selectedOrganizationId) return;

      let input = event.target.querySelector<HTMLInputElement>('input[name="workspaceOrganizationId"]');
      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = "workspaceOrganizationId";
        event.target.append(input);
      }
      input.value = selectedOrganizationId;
    }

    function bindExportLink(link: HTMLAnchorElement) {
      if (link.origin !== window.location.origin || !link.pathname.includes("/export")) return;
      const workspace = link.closest<HTMLElement>("[data-workspace-organization-id]");
      const selectedOrganizationId = workspace?.dataset.workspaceOrganizationId;
      if (!selectedOrganizationId) return;
      const url = new URL(link.href);
      url.searchParams.set("workspaceOrganizationId", selectedOrganizationId);
      link.href = url.toString();
    }

    function bindExportOrganization(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (link) bindExportLink(link);
    }

    document.querySelectorAll<HTMLAnchorElement>("[data-workspace-organization-id] a[href]").forEach(bindExportLink);
    document.addEventListener("submit", bindOrganization, true);
    document.addEventListener("click", bindExportOrganization, true);
    return () => {
      document.removeEventListener("submit", bindOrganization, true);
      document.removeEventListener("click", bindExportOrganization, true);
    };
  }, []);

  return <div data-workspace-organization-id={organizationId} style={{ display: "contents" }}>{children}</div>;
}
