import { beforeEach, describe, expect, it, vi } from "vitest";

const { findToken, transaction, hashPassword, hashToken } = vi.hoisted(() => ({
  findToken: vi.fn(),
  transaction: vi.fn(),
  hashPassword: vi.fn(),
  hashToken: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { authToken: { findFirst: findToken }, $transaction: transaction } }));
vi.mock("bcryptjs", () => ({ default: { hash: hashPassword } }));
vi.mock("@/lib/auth-token", () => ({ hashAuthToken: hashToken }));

import { POST } from "./route";

function request() {
  return new Request("https://sales.example/api/auth/password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "A".repeat(43), password: "a-new-secure-password" }),
  });
}

describe("POST /api/auth/password-reset", () => {
  const findLockedToken = vi.fn();
  const updateUser = vi.fn();
  const deleteTokens = vi.fn();
  const lockToken = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    hashToken.mockReturnValue("hashed-token");
    hashPassword.mockResolvedValue("bcrypt-hash");
    findToken.mockResolvedValue({ id: "token-1" });
    findLockedToken.mockResolvedValue({ id: "token-1", userId: "user-1" });
    updateUser.mockResolvedValue({});
    deleteTokens.mockResolvedValue({ count: 1 });
    lockToken.mockResolvedValue([]);
    transaction.mockImplementation(async (callback) => callback({
      $queryRaw: lockToken,
      authToken: { findFirst: findLockedToken, deleteMany: deleteTokens },
      user: { update: updateUser },
    }));
  });

  it("rejects unknown, expired, or consumed tokens without changing the password", async () => {
    findToken.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(hashPassword).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("updates the password, consumes tokens, and increments the session version atomically", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "bcrypt-hash", sessionVersion: { increment: 1 } },
    });
    expect(deleteTokens).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("rejects a token that expires between validation and the atomic update", async () => {
    findLockedToken.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(updateUser).not.toHaveBeenCalled();
    expect(deleteTokens).not.toHaveBeenCalled();
  });
});
