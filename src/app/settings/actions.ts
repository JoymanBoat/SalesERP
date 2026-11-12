"use server";

import { MembershipRole, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getMutationWorkspace } from "@/lib/workspace";

export type CategoryActionState = { status: "idle" | "error" | "success"; message: string };

const categorySchema = z.object({
  name: z.string().trim().min(1, "Enter a category name.").max(80),
  categoryId: z.string().cuid().optional(),
});

export async function saveCategory(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId") || undefined,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the category details." };

  const { organization, membership } = await getMutationWorkspace(formData, { feature: "pos", operation: "change" });
  if (membership.role !== MembershipRole.OWNER) return { status: "error", message: "Only an organization owner can manage categories." };

  try {
    await prisma.$transaction(async (transaction) => {
      const owner = await transaction.organizationMembership.findFirst({
        where: { organizationId: organization.id, userId: membership.userId, role: MembershipRole.OWNER },
        select: { id: true },
      });
      if (!owner) throw new Error("CATEGORY_ACTOR_NOT_OWNER");

      let categoryId = parsed.data.categoryId;
      if (categoryId) {
        const updated = await transaction.category.updateMany({
          where: { id: categoryId, organizationId: organization.id },
          data: { name: parsed.data.name },
        });
        if (updated.count !== 1) throw new Error("CATEGORY_NOT_AVAILABLE");
      } else {
        const category = await transaction.category.create({
          data: { organizationId: organization.id, name: parsed.data.name },
          select: { id: true },
        });
        categoryId = category.id;
      }

      await transaction.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: membership.userId,
          action: parsed.data.categoryId ? "category.updated" : "category.created",
          entityType: "Category",
          entityId: categoryId,
          details: { name: parsed.data.name },
        },
      });
    });

    revalidatePath("/settings");
    revalidatePath("/products");
    revalidatePath("/inventory");
    return { status: "success", message: parsed.data.categoryId ? "Category updated." : "Category added." };
  } catch (error) {
    if (error instanceof Error && error.message === "CATEGORY_ACTOR_NOT_OWNER") {
      return { status: "error", message: "Your owner access is no longer available." };
    }
    if (error instanceof Error && error.message === "CATEGORY_NOT_AVAILABLE") {
      return { status: "error", message: "That category is no longer available. Refresh and try again." };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "A category with that name already exists." };
    }
    console.error("Category save failed.", error);
    return { status: "error", message: "The category could not be saved. Please try again." };
  }
}
