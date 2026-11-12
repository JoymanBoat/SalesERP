"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { getVisibleNotificationTypes } from "@/lib/permissions";
import { getMutationWorkspace } from "@/lib/workspace";

export async function markNotificationRead(formData: FormData) {
  const notificationId = String(formData.get("notificationId") ?? "").trim();
  if (!notificationId || notificationId.length > 40) return;
  const { membership, organization, activeStores } = await getMutationWorkspace(formData, { operation: "change" });
  if (activeStores.length === 0) return;

  await prisma.inAppNotification.updateMany({
    where: {
      id: notificationId,
      membershipId: membership.id,
      organizationId: organization.id,
      storeId: { in: activeStores.map(({ id }) => id) },
      type: { in: getVisibleNotificationTypes(membership.role) },
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
}
