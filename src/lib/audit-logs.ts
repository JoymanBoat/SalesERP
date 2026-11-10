import type { Prisma } from "@prisma/client";

export function buildAuditLogWhere(organizationId: string, query: string, action: string): Prisma.AuditLogWhereInput {
  const normalizedQuery = query.trim().slice(0, 80);
  return {
    organizationId,
    ...(action ? { action } : {}),
    ...(normalizedQuery
      ? {
          OR: [
            { action: { contains: normalizedQuery, mode: "insensitive" } },
            { entityType: { contains: normalizedQuery, mode: "insensitive" } },
            { entityId: { contains: normalizedQuery, mode: "insensitive" } },
            { actor: { is: { name: { contains: normalizedQuery, mode: "insensitive" } } } },
            { actor: { is: { email: { contains: normalizedQuery, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
}
