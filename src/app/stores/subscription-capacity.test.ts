import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), transaction: vi.fn(), query: vi.fn(), owner: vi.fn(), subscription: vi.fn(), count: vi.fn(), create: vi.fn(), findStore: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/workspace", () => ({ getWorkspace: mocks.workspace }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createStore, setStoreActive } from "./actions";

const previous = { status: "idle" as const, message: "" };
const storeId = "clh1p2s3t0000qwertyuiopas";

describe("store subscription capacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspace.mockResolvedValue({ organization: { id: "org" }, membership: { role: "OWNER", userId: "owner" } });
    mocks.owner.mockResolvedValue({ id: "membership" });
    mocks.subscription.mockResolvedValue({
      kind: "PAID", expiresAt: new Date("2099-01-01"), packageId: "starter",
      package: { id: "starter", name: "Starter", features: ["pos"], maxStores: 1, maxStaff: 2 },
    });
    mocks.count.mockResolvedValue(1);
    mocks.findStore.mockResolvedValue({ id: storeId, name: "Other", active: false });
    mocks.transaction.mockImplementation((fn) => fn({
      $queryRaw: mocks.query,
      organizationMembership: { findFirst: mocks.owner },
      organizationSubscription: { findUnique: mocks.subscription },
      store: { count: mocks.count, create: mocks.create, findFirst: mocks.findStore, update: mocks.update },
    }));
  });

  it("blocks store creation at the limit after taking the organization lock", async () => {
    const form = new FormData();
    form.set("name", "New store");
    form.set("code", "NEW");
    const result = await createStore(previous, form);
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("active store limit") });
    expect(mocks.query).toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("blocks reactivation at the limit", async () => {
    const form = new FormData();
    form.set("storeId", storeId);
    form.set("active", "true");
    const result = await setStoreActive(previous, form);
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("active store limit") });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
