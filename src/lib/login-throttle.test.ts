import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { withLoginThrottle } from "./login-throttle";

describe("shared login throttle", () => {
  beforeEach(() => { vi.spyOn(Math, "random").mockReturnValue(0.5); });
  afterEach(() => { vi.restoreAllMocks(); });
  function setup(failures: number) {
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(failures ? [{ failures }] : []);
    const execute = vi.fn().mockResolvedValue(1);
    const transaction = { $queryRaw: query, $executeRaw: execute };
    const prisma = { $transaction: vi.fn((callback) => callback(transaction)) } as unknown as PrismaClient;
    return { prisma, transaction, query, execute };
  }

  it("serializes attempts per normalized email before checking shared failures", async () => {
    const { prisma, query, execute } = setup(7);
    const authenticate = vi.fn().mockResolvedValue(null);
    expect(await withLoginThrottle(prisma, " USER@example.com ", authenticate)).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalled();
    const lockKey = query.mock.calls[0][1];
    expect(lockKey).toMatch(/^[a-f0-9]{64}$/);
    expect(query.mock.calls[1][1]).toBe(lockKey);
  });

  it("rejects blocked attempts without checking credentials", async () => {
    const { prisma, execute } = setup(8);
    const authenticate = vi.fn();
    expect(await withLoginThrottle(prisma, "user@example.com", authenticate)).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("clears failures on success and propagates database errors", async () => {
    const { prisma, execute } = setup(2);
    const user = { id: "user-1" };
    expect(await withLoginThrottle(prisma, "user@example.com", async () => user)).toEqual(user);
    expect(execute.mock.calls[0][0].join("")).toContain('DELETE FROM "LoginThrottle"');
    const error = new Error("database unavailable");
    const failed = { $transaction: vi.fn().mockRejectedValue(error) } as unknown as PrismaClient;
    await expect(withLoginThrottle(failed, "user@example.com", async () => user)).rejects.toThrow("database unavailable");
  });
});
