"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { packageConfigurationSchema } from "@/lib/package-validation";
import { prisma } from "@/lib/prisma";

export type PackageActionState = { status: "idle" | "error" | "success"; message: string };

export async function updatePackage(_previous: PackageActionState, formData: FormData): Promise<PackageActionState> {
  const session = await requirePlatformAdmin();
  const parsed = packageConfigurationSchema.safeParse({
    id: formData.get("id"),
    revision: formData.get("revision"),
    features: formData.getAll("features"),
    maxStores: formData.get("maxStores"),
    maxStaff: formData.get("maxStaff"),
    monthlyPrice: formData.get("monthlyPrice"),
    annualPrice: formData.get("annualPrice"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the package details." };

  const { id, revision, ...configuration } = parsed.data;
  try {
    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.subscriptionPackage.updateMany({
        where: { id, revision },
        data: { ...configuration, revision: { increment: 1 } },
      });
      if (result.count !== 1) return false;
      await transaction.platformAuditEvent.create({
        data: {
          actorId: session.user.id,
          action: "subscription_package.updated",
          details: { packageId: id, ...configuration },
        },
      });
      return true;
    });
    if (!updated) return { status: "error", message: "This package changed or is no longer available. Refresh and try again." };
  } catch (error) {
    console.error("Package configuration update failed.", error);
    return { status: "error", message: "The package could not be saved. Please try again." };
  }

  revalidatePath("/platform/packages");
  return { status: "success", message: "Package configuration saved and applied to active subscriptions using this package." };
}
