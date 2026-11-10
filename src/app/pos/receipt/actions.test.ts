import { OrderStatus, Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { findOrder, getWorkspace } = vi.hoisted(() => ({ findOrder: vi.fn(), getWorkspace: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findFirst: findOrder } } }));
vi.mock("@/lib/workspace", () => ({ getWorkspace }));
import { prepareReceiptShare } from "./actions";
import { readReceiptToken } from "@/lib/receipt-link";

const orderId = "clh1p2s3t0000qwertyuiopas";
const secret = "test-secret-at-least-32-characters-long";
const idle = { status: "idle" as const, message: "" };
function data(id = orderId) {
  const formData = new FormData();
  formData.set("orderId", id);
  return formData;
}

describe("prepareReceiptShare", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("creates a link only for a completed sale in the selected store", async () => {
    vi.stubEnv("AUTH_SECRET", secret);
    vi.stubEnv("AUTH_URL", "https://shop.example");
    getWorkspace.mockResolvedValue({ organization: { id: "org-1", name: "Shop" }, store: { id: "store-1" } });
    findOrder.mockResolvedValue({ id: orderId, number: 42, total: new Prisma.Decimal("15"), status: OrderStatus.PAID });
    const result = await prepareReceiptShare(idle, data());
    expect(result.status).toBe("success");
    expect(findOrder).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1", storeId: "store-1", status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED] } }) }));
    const url = new URL(result.url!);
    expect(readReceiptToken(url.pathname.split("/").pop()!, secret)?.orderId).toBe(orderId);
    expect(result.text).toContain(result.url);
  });

  it("refuses unavailable sales and local-only receipt addresses", async () => {
    vi.stubEnv("AUTH_SECRET", secret);
    vi.stubEnv("AUTH_URL", "http://localhost:3000");
    getWorkspace.mockResolvedValue({ organization: { id: "org-1", name: "Shop" }, store: { id: "store-1" } });
    findOrder.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: orderId, number: 42, total: new Prisma.Decimal("15"), status: OrderStatus.PAID });
    expect((await prepareReceiptShare(idle, data())).status).toBe("error");
    expect((await prepareReceiptShare(idle, data())).message).toContain("localhost");
    expect((await prepareReceiptShare(idle, data("invalid"))).status).toBe("error");
  });
});
