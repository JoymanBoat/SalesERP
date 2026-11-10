import { describe, expect, it } from "vitest";

import { buildAuditLogWhere } from "./audit-logs";

describe("audit history filters", () => {
  it("always scopes queries to the organization and optionally selects an action", () => {
    expect(buildAuditLogWhere("org-1", "", "product.created")).toEqual({
      organizationId: "org-1",
      action: "product.created",
    });
  });

  it("searches action, entity, and actor fields with a trimmed bounded query", () => {
    const query = "a".repeat(80);
    expect(buildAuditLogWhere("org-1", `  ${"a".repeat(90)}  `, "")).toEqual({
      organizationId: "org-1",
      OR: [
        { action: { contains: query, mode: "insensitive" } },
        { entityType: { contains: query, mode: "insensitive" } },
        { entityId: { contains: query, mode: "insensitive" } },
        {
          actor: {
            is: {
              name: { contains: query, mode: "insensitive" },
            },
          },
        },
        {
          actor: {
            is: {
              email: { contains: query, mode: "insensitive" },
            },
          },
        },
      ],
    });
  });

  it("ignores an empty or whitespace-only search", () => {
    expect(buildAuditLogWhere("org-1", "   ", "")).toEqual({ organizationId: "org-1" });
  });
});
