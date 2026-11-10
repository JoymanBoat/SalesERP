import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, findAdmin, redirect } = vi.hoisted(() => ({
  auth: vi.fn(),
  findAdmin: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }),
}));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { platformAdmin: { findUnique: findAdmin } } }));
vi.mock("next/navigation", () => ({ redirect }));

import { requirePlatformAdmin } from "./platform-admin";

describe("platform administrator authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects anonymous and revoked sessions", async () => {
    auth.mockResolvedValueOnce(null).mockResolvedValueOnce({ user: { id: "user-1" }, revoked: true });
    await expect(requirePlatformAdmin()).rejects.toThrow("REDIRECT:/login");
    await expect(requirePlatformAdmin()).rejects.toThrow("REDIRECT:/login?revoked=1");
    expect(findAdmin).not.toHaveBeenCalled();
  });

  it("checks current administrator status on every request", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" }, revoked: false });
    findAdmin.mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: "user-1" });
    await expect(requirePlatformAdmin()).rejects.toThrow("REDIRECT:/dashboard?denied=1");
    await expect(requirePlatformAdmin()).resolves.toEqual({ user: { id: "user-1" }, revoked: false });
    expect(findAdmin).toHaveBeenCalledTimes(2);
    expect(findAdmin).toHaveBeenCalledWith({ where: { userId: "user-1" }, select: { userId: true } });
  });
});
