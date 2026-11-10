import { beforeEach, describe, expect, it, vi } from "vitest";

const { transaction, findToken, deleteTokens, updateUsers } = vi.hoisted(() => ({
  transaction: vi.fn(),
  findToken: vi.fn(),
  deleteTokens: vi.fn(),
  updateUsers: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import { hashAuthToken } from "@/lib/auth-token";
import { POST } from "./route";

const token = "a".repeat(43);

function request(body: unknown) {
  return new Request("https://sales.example/api/auth/email-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/email-verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findToken.mockResolvedValue({ userId: "user-1" });
    deleteTokens.mockResolvedValue({ count: 1 });
    updateUsers.mockResolvedValue({ count: 1 });
    transaction.mockImplementation(async (callback) => callback({
      authToken: { findFirst: findToken, deleteMany: deleteTokens },
      user: { updateMany: updateUsers },
    }));
  });

  it("rejects malformed tokens without touching the database", async () => {
    const response = await POST(request({ token: "short" }));

    expect(response.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("consumes a valid one-time token and marks the email verified", async () => {
    const response = await POST(request({ token }));

    expect(response.status).toBe(200);
    expect(findToken).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tokenHash: hashAuthToken(token), type: "EMAIL_VERIFICATION" }),
    }));
    expect(updateUsers).toHaveBeenCalledWith({
      where: { id: "user-1", emailVerified: null },
      data: { emailVerified: expect.any(Date) },
    });
  });

  it("rejects unknown, expired or already used tokens", async () => {
    findToken.mockResolvedValue(null);

    const response = await POST(request({ token }));

    expect(response.status).toBe(400);
    expect(updateUsers).not.toHaveBeenCalled();
  });

  it("does not verify when a concurrent request already claimed the token", async () => {
    deleteTokens.mockResolvedValue({ count: 0 });

    const response = await POST(request({ token }));

    expect(response.status).toBe(400);
    expect(updateUsers).not.toHaveBeenCalled();
  });
});
