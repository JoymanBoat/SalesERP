import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { MembershipRole } from "@prisma/client";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAccessibleStores } from "@/lib/store-access";
import { getOrganizationSubscription } from "@/lib/subscription-access";
import { canUseSubscriptionFeature, subscriptionIsReadOnly, type SubscriptionFeature } from "@/lib/subscription-policy";

export async function hasWorkspaceMembership(userId: string) {
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId },
    select: { id: true },
  });
  return membership !== null;
}

type WorkspaceOptions = {
  allowedRoles?: MembershipRole[];
  feature?: SubscriptionFeature;
  organizationId?: string;
  operation: "view" | "change";
};

export async function getWorkspace(options: WorkspaceOptions) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.revoked) redirect("/login?revoked=1");
  const cookieStore = await cookies();
  const selectedStoreId = cookieStore.get("saleserp-store-id")?.value;
  const selectedOrganizationId = options.organizationId ?? cookieStore.get("saleserp-organization-id")?.value;
  const isExplicitOrganization = options.organizationId !== undefined;

  let membership = await prisma.organizationMembership.findFirst({
    where: {
      userId: session.user.id,
      ...(isExplicitOrganization || selectedOrganizationId ? { organizationId: selectedOrganizationId } : {}),
    },
    include: {
      storeAssignments: { select: { storeId: true } },
      organization: {
        include: {
          stores: {
            where: { active: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!membership && isExplicitOrganization) redirect("/dashboard?workspaceError=unavailable");
  if (!membership && selectedOrganizationId) {
    membership = await prisma.organizationMembership.findFirst({
      where: { userId: session.user.id },
      include: {
        storeAssignments: { select: { storeId: true } },
        organization: {
          include: {
            stores: { where: { active: true }, orderBy: { createdAt: "asc" } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }
  if (!membership) redirect("/register");
  if (options.allowedRoles && !options.allowedRoles.includes(membership.role)) redirect("/dashboard?denied=1");

  const subscription = await getOrganizationSubscription(prisma, membership.organizationId);
  const now = new Date();
  if (options.operation === "change" && subscriptionIsReadOnly(subscription, now)) {
    redirect("/subscription?reason=expired");
  }

  if (options.feature && !canUseSubscriptionFeature(subscription, options.feature, options.operation, now)) {
    redirect(`/subscription?reason=feature&feature=${options.feature}`);
  }

  const activeStores = getAccessibleStores(
    membership.role,
    membership.organization.stores,
    membership.storeAssignments.map(({ storeId }) => storeId),
  );
  const store = activeStores.find((candidate) => candidate.id === selectedStoreId) ?? activeStores[0];
  if (!store) redirect("/store-access");
  const registers = await prisma.posRegister.findMany({
    where: {
      organizationId: membership.organizationId,
      storeId: store.id,
      active: true,
      ...(membership.role === "OWNER" ? {} : { assignments: { some: { membershipId: membership.id } } }),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, code: true },
  });
  const selectedRegisterId = cookieStore.get("saleserp-register-id")?.value;
  const register = registers.find(({ id }) => id === selectedRegisterId) ?? registers[0] ?? null;

  return {
    session,
    membership,
    organization: membership.organization,
    subscription,
    store,
    activeStores,
    registers,
    register,
  };
}

export async function getMutationWorkspace(
  formData: FormData,
  options: Omit<WorkspaceOptions, "organizationId">,
) {
  const organizationId = formData.get("workspaceOrganizationId");
  if (typeof organizationId !== "string" || organizationId.length === 0 || organizationId.length > 40) {
    redirect("/dashboard?workspaceError=stale");
  }
  return getWorkspace({ ...options, organizationId });
}
