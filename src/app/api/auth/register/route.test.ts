import { beforeEach, describe, expect, it, vi } from "vitest";

const { transaction, hash, sendVerification, afterTasks } = vi.hoisted(() => ({
  transaction: vi.fn(),
  hash: vi.fn(),
  sendVerification: vi.fn(),
  afterTasks: [] as Array<() => Promise<void>>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: transaction },
}));

vi.mock("bcryptjs", () => ({
  default: { hash },
}));

vi.mock("@/lib/email-verification", () => ({ sendEmailVerification: sendVerification }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: () => Promise<void>) => { afterTasks.push(task); } };
});

import { Prisma } from "@prisma/client";
import { POST } from "./route";

function validRequest() {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ownerName: "Ama Mensah",
      businessName: "Accra Home",
      storeName: "Osu",
      email: "AMA@example.com ",
      password: "a-secure-password",
    }),
  });
}

describe("POST /api/auth/register", () => {
  const userCreate = vi.fn();
  const organizationCreate = vi.fn();
  const membershipCreate = vi.fn();
  const storeCreate = vi.fn();
  const registerCreate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    afterTasks.length = 0;
    hash.mockResolvedValue("hashed-password");
    userCreate.mockResolvedValue({ id: "user-1", email: "ama@example.com" });
    organizationCreate.mockResolvedValue({ id: "org-1" });
    membershipCreate.mockResolvedValue({});
    storeCreate.mockResolvedValue({ id: "store-1" });
    registerCreate.mockResolvedValue({});
    transaction.mockImplementation(async (callback) => callback({
      user: { create: userCreate },
      organization: { create: organizationCreate },
      organizationMembership: { create: membershipCreate },
      store: { create: storeCreate },
      posRegister: { create: registerCreate },
    }));
  });

  it("rejects malformed or invalid registration without starting a transaction", async () => {
    const malformed = await POST(new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: "{",
    }));
    const invalid = await POST(new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invalid" }),
    }));

    expect(malformed.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
  });

  it("creates the owner, Ghana organization, initial store, and main register atomically", async () => {
    const response = await POST(validRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(hash).toHaveBeenCalledWith("a-secure-password", 12);
    expect(userCreate).toHaveBeenCalledWith({
      data: {
        name: "Ama Mensah",
        email: "ama@example.com",
        passwordHash: "hashed-password",
      },
    });
    expect(organizationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Accra Home",
        currency: "GHS",
        countryCode: "GH",
        timezone: "Africa/Accra",
      }),
    });
    expect(membershipCreate).toHaveBeenCalledWith({
      data: { organizationId: "org-1", userId: "user-1", role: "OWNER" },
    });
    expect(storeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: "org-1", name: "Osu", code: "OSU" }),
    });
    expect(registerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        storeId: "store-1",
        name: "Main register",
        code: "MAIN",
      }),
    });
    expect(sendVerification).not.toHaveBeenCalled();
    await afterTasks[0]();
    expect(sendVerification).toHaveBeenCalledWith({ id: "user-1", email: "ama@example.com" });
  });

  it("returns a conflict when the email is already registered", async () => {
    const duplicateEmail = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test", meta: { target: ["email"] } },
    );
    userCreate.mockRejectedValue(duplicateEmail);

    const response = await POST(validRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "An account with this email already exists.",
    });
  });
});
