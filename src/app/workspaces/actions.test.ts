import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cookies: vi.fn(),
  findMembership: vi.fn(),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { organizationMembership: { findFirst: mocks.findMembership } },
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));

import { switchActiveOrganization } from "./actions";

describe("switchActiveOrganization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" }, revoked: false });
    mocks.findMembership.mockResolvedValue({ id: "membership-2" });
    mocks.cookies.mockResolvedValue({ set: mocks.setCookie, delete: mocks.deleteCookie });
  });

  it("sets only an organization the authenticated user belongs to and clears dependent selections", async () => {
    const formData = new FormData();
    formData.set("organizationId", "org-2");

    await expect(switchActiveOrganization(formData)).rejects.toThrow("REDIRECT:/dashboard");

    expect(mocks.findMembership).toHaveBeenCalledWith({
      where: { userId: "user-1", organizationId: "org-2" },
      select: { id: true },
    });
    expect(mocks.setCookie).toHaveBeenCalledWith("saleserp-organization-id", "org-2", expect.objectContaining({
      httpOnly: true,
      sameSite: "lax",
    }));
    expect(mocks.deleteCookie).toHaveBeenCalledWith("saleserp-store-id");
    expect(mocks.deleteCookie).toHaveBeenCalledWith("saleserp-register-id");
  });

  it("rejects organizations outside the authenticated user's memberships", async () => {
    mocks.findMembership.mockResolvedValue(null);
    const formData = new FormData();
    formData.set("organizationId", "org-not-mine");

    await expect(switchActiveOrganization(formData)).rejects.toThrow("REDIRECT:/dashboard?workspaceError=unavailable");
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
});
