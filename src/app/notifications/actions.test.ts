import { beforeEach, describe, expect, it, vi } from "vitest";
import { MembershipRole } from "@prisma/client";

const { updateMany, revalidatePath, getWorkspace } = vi.hoisted(() => ({
  updateMany: vi.fn(),
  revalidatePath: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { inAppNotification: { updateMany } },
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace,
  getMutationWorkspace: (_formData: FormData, options: unknown) => getWorkspace(options),
}));

import { markNotificationRead } from "./actions";
import { getVisibleNotificationTypes } from "@/lib/permissions";

describe("markNotificationRead", () => {
  beforeEach(() => {
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    revalidatePath.mockReset();
    getWorkspace.mockReset().mockResolvedValue({
      membership: { id: "membership-a", role: MembershipRole.OWNER },
      organization: { id: "organization-a" },
      activeStores: [{ id: "store-a" }],
    });
  });

  it("only marks notifications belonging to the signed-in membership and accessible stores", async () => {
    const formData = new FormData();
    formData.set("notificationId", "notification-a");

    await markNotificationRead(formData);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "notification-a",
        membershipId: "membership-a",
        organizationId: "organization-a",
        storeId: { in: ["store-a"] },
        readAt: null,
        type: { in: getVisibleNotificationTypes(MembershipRole.OWNER) },
      },
      data: { readAt: expect.any(Date) },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/notifications");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("ignores malformed notification IDs without accessing notification data", async () => {
    const formData = new FormData();
    formData.set("notificationId", "x".repeat(41));

    await markNotificationRead(formData);

    expect(getWorkspace).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
