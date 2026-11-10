import { MembershipRole } from "@prisma/client";

export function getAccessibleStores<T extends { id: string }>(
  role: MembershipRole,
  activeStores: T[],
  assignedStoreIds: Iterable<string>,
) {
  if (role === MembershipRole.OWNER) return activeStores;

  const assignedIds = new Set(assignedStoreIds);
  return activeStores.filter((store) => assignedIds.has(store.id));
}
