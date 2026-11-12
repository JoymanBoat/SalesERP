import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  transaction,
  getWorkspace,
  sendEmail,
  revalidatePath,
  createToken,
  deleteInvitations,
} = vi.hoisted(() => ({
  transaction: vi.fn(),
  getWorkspace: vi.fn(),
  sendEmail: vi.fn(),
  revalidatePath: vi.fn(),
  createToken: vi.fn(),
  deleteInvitations: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transaction,
    employeeInvitation: { deleteMany: deleteInvitations },
  },
}));
vi.mock("@/lib/workspace", () => ({
  getWorkspace,
  getMutationWorkspace: (_formData: FormData, options: unknown) => getWorkspace(options),
}));
vi.mock("@/lib/email", () => ({ sendEmail }));
vi.mock("@/lib/auth-token", () => ({
  authBaseUrl: () => new URL("https://sales.example/"),
  createAuthToken: createToken,
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { MembershipRole } from "@prisma/client";
import { inviteOrganizationMember } from "./actions";

const previousState = { status: "idle" as const, message: "" };
const storeId = "clh1p2s3t0000qwertyuiopas";
const registerId = "clh1p2s3t0001qwertyuiopas";

describe("inviteOrganizationMember", () => {
  const queryRaw = vi.fn();
  const findOwner = vi.fn();
  const findUser = vi.fn();
  const findInvitation = vi.fn();
  const findStores = vi.fn();
  const findRegisters = vi.fn();
  const createInvitation = vi.fn();
  const findSubscription = vi.fn();
  const countMembers = vi.fn();

  function invitationForm() {
    const formData = new FormData();
    formData.set("email", "Employee@example.com");
    formData.set("role", "CASHIER");
    formData.set("storeIds", storeId);
    formData.set("registerIds", registerId);
    return formData;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspace.mockResolvedValue({
      organization: { id: "org-1", name: "Keta Retail" },
      membership: { role: MembershipRole.OWNER, userId: "owner-1" },
    });
    createToken.mockReturnValue({ token: "A".repeat(43), tokenHash: "hashed-token" });
    sendEmail.mockResolvedValue(undefined);
    queryRaw.mockResolvedValue([]);
    findOwner.mockResolvedValue({ id: "owner-membership" });
    findUser.mockResolvedValue(null);
    findInvitation.mockResolvedValue(null);
    deleteInvitations.mockResolvedValue({ count: 0 });
    findStores.mockResolvedValue([{ id: storeId }]);
    findRegisters.mockResolvedValue([{ id: registerId }]);
    createInvitation.mockResolvedValue({});
    findSubscription.mockResolvedValue(null);
    countMembers.mockResolvedValue(1);
    transaction.mockImplementation(async (callback) => callback({
      $queryRaw: queryRaw,
      organizationMembership: { findFirst: findOwner, count: countMembers },
      organizationSubscription: { findUnique: findSubscription },
      user: { findUnique: findUser },
      employeeInvitation: {
        findFirst: findInvitation,
        deleteMany: deleteInvitations,
        create: createInvitation,
      },
      store: { findMany: findStores },
      posRegister: { findMany: findRegisters },
    }));
  });

  it("creates an invitation with a hashed token and sends a 72-hour acceptance link", async () => {
    const result = await inviteOrganizationMember(previousState, invitationForm());

    expect(result).toEqual({ status: "success", message: "An invitation was sent to employee@example.com." });
    expect(createInvitation).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        invitedById: "owner-1",
        email: "employee@example.com",
        role: "CASHIER",
        storeIds: [storeId],
        registerIds: [registerId],
        tokenHash: "hashed-token",
        expiresAt: expect.any(Date),
      }),
    });
    const expiresAt = createInvitation.mock.calls[0][0].data.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 71 * 60 * 60_000);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "employee@example.com",
      text: expect.stringContaining("https://sales.example/accept-invitation?token="),
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/team");
  });

  it("requires active stores and a current owner before creating an invitation", async () => {
    findStores.mockResolvedValue([]);

    const result = await inviteOrganizationMember(previousState, invitationForm());

    expect(result.status).toBe("error");
    expect(createInvitation).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects accounts that already exist and active duplicate invitations", async () => {
    findUser.mockResolvedValue({ id: "user-1" });
    const existingAccount = await inviteOrganizationMember(previousState, invitationForm());
    expect(existingAccount.message).toContain("Add the existing account instead.");

    findUser.mockResolvedValue(null);
    findInvitation.mockResolvedValue({ id: "invite-1" });
    const duplicateInvite = await inviteOrganizationMember(previousState, invitationForm());
    expect(duplicateInvite.message).toContain("An active invitation already exists");
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("removes the invitation and reports mail-delivery failures", async () => {
    sendEmail.mockRejectedValue(new Error("SMTP unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await inviteOrganizationMember(previousState, invitationForm());

    expect(result).toEqual({
      status: "error",
      message: "The invitation email could not be sent. Check SMTP settings and try again.",
    });
    expect(deleteInvitations).toHaveBeenLastCalledWith({ where: { tokenHash: "hashed-token" } });
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  it("does not issue an invitation when the staff limit is reached", async () => {
    findSubscription.mockResolvedValue({
      kind: "PAID", expiresAt: new Date("2099-01-01"), packageId: "starter",
      package: { id: "starter", name: "Starter", features: ["pos"], maxStores: 1, maxStaff: 1 },
    });
    const result = await inviteOrganizationMember(previousState, invitationForm());
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("staff limit") });
    expect(createInvitation).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
