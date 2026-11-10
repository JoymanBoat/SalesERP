import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUser, transaction, deleteTokens, createToken, sendEmail, logError, scheduleAfter, afterTasks } = vi.hoisted(() => ({
  findUser: vi.fn(),
  transaction: vi.fn(),
  deleteTokens: vi.fn(),
  createToken: vi.fn(),
  sendEmail: vi.fn(),
  logError: vi.fn(),
  scheduleAfter: vi.fn(),
  afterTasks: [] as Array<() => Promise<void>>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: findUser },
    authToken: { deleteMany: deleteTokens },
    $transaction: transaction,
  },
}));
vi.mock("@/lib/auth-token", () => ({
  authBaseUrl: () => new URL("https://sales.example/"),
  createAuthToken: createToken,
}));
vi.mock("@/lib/email", () => ({ sendEmail }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: scheduleAfter };
});

import { POST } from "./route";

function request(email = "person@example.com") {
  return new Request("https://sales.example/api/auth/password-reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

async function runScheduledWork() {
  await Promise.all(afterTasks.splice(0).map((task) => task()));
}

describe("POST /api/auth/password-reset/request", () => {
  const recentRequest = vi.fn();
  const deletePrevious = vi.fn();
  const createStoredToken = vi.fn();
  const lockAccount = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    afterTasks.length = 0;
    scheduleAfter.mockImplementation((task: () => Promise<void>) => afterTasks.push(task));
    vi.spyOn(console, "error").mockImplementation(logError);
    createToken.mockReturnValue({ token: "raw-one-time-token", tokenHash: "hashed-token" });
    sendEmail.mockResolvedValue(undefined);
    findUser.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    recentRequest.mockResolvedValue(null);
    deletePrevious.mockResolvedValue({ count: 0 });
    createStoredToken.mockResolvedValue({});
    lockAccount.mockResolvedValue([]);
    transaction.mockImplementation(async (callback) => callback({
      $queryRaw: lockAccount,
      authToken: {
        findFirst: recentRequest,
        deleteMany: deletePrevious,
        create: createStoredToken,
      },
    }));
    deleteTokens.mockResolvedValue({ count: 1 });
  });

  it("uses the same accepted response for unknown addresses", async () => {
    findUser.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      message: "If an account exists for that email, a password-reset link will be sent.",
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(scheduleAfter).not.toHaveBeenCalled();
  });

  it("returns before sending mail and stores only a token hash", async () => {
    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(scheduleAfter).toHaveBeenCalledOnce();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createStoredToken).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        tokenHash: "hashed-token",
        type: "PASSWORD_RESET",
        expiresAt: expect.any(Date),
      }),
    });
    await runScheduledWork();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "person@example.com",
      text: expect.stringContaining("https://sales.example/reset-password?token=raw-one-time-token"),
    }));
    expect(JSON.stringify(createStoredToken.mock.calls)).not.toContain("raw-one-time-token");
  });

  it("throttles repeated requests without sending another email", async () => {
    recentRequest.mockResolvedValue({ id: "recent-token" });

    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createStoredToken).not.toHaveBeenCalled();
  });

  it("removes the unusable token and keeps the response non-enumerating on mail errors", async () => {
    sendEmail.mockRejectedValue(new Error("mail unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(202);
    await runScheduledWork();
    expect(deleteTokens).toHaveBeenCalledWith({ where: { tokenHash: "hashed-token" } });
    expect(logError).toHaveBeenCalled();
  });
});
