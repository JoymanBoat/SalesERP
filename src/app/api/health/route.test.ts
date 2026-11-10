import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({
  queryRaw: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: queryRaw },
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("reports healthy only after the database check succeeds", async () => {
    queryRaw.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      database: "connected",
    });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("returns an explicit unavailable response when the database check fails", async () => {
    const error = new Error("database unavailable");
    queryRaw.mockRejectedValue(error);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "unavailable",
      database: "disconnected",
    });
    expect(errorLog).toHaveBeenCalledWith(
      "Health check could not reach the database.",
      error,
    );
    errorLog.mockRestore();
  });
});
