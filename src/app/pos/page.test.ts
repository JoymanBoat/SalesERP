import { MembershipRole, Prisma, TaxComponent } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { getWorkspace, terminal } = vi.hoisted(() => ({ getWorkspace: vi.fn(), terminal: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ getWorkspace }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    registerShift: { findFirst: vi.fn().mockResolvedValue({ id: "shift-1" }) },
    productVariant: { findMany: vi.fn().mockResolvedValue([]) },
    customer: { findMany: vi.fn().mockResolvedValue([]) },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    promotion: { findMany: vi.fn().mockResolvedValue([]) },
    taxRateSetting: { findMany: vi.fn().mockResolvedValue([
      { component: TaxComponent.VAT, rate: new Prisma.Decimal("15"), effectiveFrom: new Date("2020-01-01T00:00:00Z") },
    ]) },
  },
}));
vi.mock("@/components/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/void-sale-form", () => ({ VoidSaleForm: () => null }));
vi.mock("@/components/pos-terminal", async () => {
  const { createElement } = await import("react");
  return { PosTerminal: (props: unknown) => {
    terminal(props);
    return createElement("div", null, "Sale terminal");
  } };
});

import PosPage from "./page";

describe("Point of sale page", () => {
  it("shows the sale terminal with current tax rates but no tax setup controls", async () => {
    getWorkspace.mockResolvedValue({
      session: { user: { name: "Test" } },
      membership: { id: "membership-1", role: MembershipRole.MANAGER },
      organization: { id: "org-1", name: "Shop", timezone: "Africa/Accra", currency: "GHS" },
      store: { id: "store-1", name: "Main" },
      register: { id: "register-1", name: "Till", code: "MAIN" },
    });

    const markup = renderToStaticMarkup(await PosPage({ searchParams: Promise.resolve({}) }));

    expect(markup).toContain("Sale terminal");
    expect(markup).not.toContain("Tax setup");
    expect(markup).not.toContain("Save tax rates");
    expect(terminal).toHaveBeenCalledWith(expect.objectContaining({
      taxRates: { vat: "15.00", nhil: "0.00", getfund: "0.00" },
    }));
  });
});
