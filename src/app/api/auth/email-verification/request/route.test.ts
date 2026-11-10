import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUser, sendVerification, afterTasks } = vi.hoisted(() => ({
  findUser: vi.fn(),
  sendVerification: vi.fn(),
  afterTasks: [] as Array<() => Promise<void>>,
}));

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: findUser } } }));
vi.mock("@/lib/email-verification", () => ({ sendEmailVerification: sendVerification }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: () => Promise<void>) => { afterTasks.push(task); } };
});

import { POST } from "./route";

function request(email: string) {
  return new Request("https://sales.example/api/auth/email-verification/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

describe("POST /api/auth/email-verification/request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterTasks.length = 0;
  });

  it("rejects invalid email input", async () => {
    expect((await POST(request("nope"))).status).toBe(400);
    expect(findUser).not.toHaveBeenCalled();
  });

  it("sends a link for an unverified account", async () => {
    const user = { id: "user-1", email: "a@example.com", emailVerified: null };
    findUser.mockResolvedValue(user);

    const response = await POST(request("A@example.com"));
    await afterTasks[0]();

    expect(response.status).toBe(202);
    expect(sendVerification).toHaveBeenCalledWith(user);
  });

  it("responds identically without sending for unknown or already verified accounts", async () => {
    findUser.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "u", email: "a@example.com", emailVerified: new Date() });

    const unknown = await POST(request("a@example.com"));
    const verified = await POST(request("a@example.com"));

    expect(unknown.status).toBe(202);
    expect(await verified.json()).toEqual(await unknown.json());
    expect(afterTasks).toHaveLength(0);
    expect(sendVerification).not.toHaveBeenCalled();
  });
});
