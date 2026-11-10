import { MembershipRole, Prisma, TaxComponent } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getWorkspace, findCategories, findTaxRates, taxForm } = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  findCategories: vi.fn(),
  findTaxRates: vi.fn(),
  taxForm: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({ getWorkspace }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findMany: findCategories },
    taxRateSetting: { findMany: findTaxRates },
  },
}));
vi.mock("@/components/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/category-management", async () => {
  const { createElement } = await import("react");
  return { CategoryManagement: () => createElement("div", null, "Category management") };
});
vi.mock("@/components/pos-settings-form", async () => {
  const { createElement } = await import("react");
  return { PosSettingsForm: (props: unknown) => {
    taxForm(props);
    return createElement("div", null, "Tax controls");
  } };
});

import SettingsPage from "./page";

describe("Settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findCategories.mockResolvedValue([{ id: "cat-1", name: "Drinks" }]);
    findTaxRates.mockResolvedValue([
      { component: TaxComponent.VAT, rate: new Prisma.Decimal("15"), effectiveFrom: new Date("2020-01-01T00:00:00Z") },
      { component: TaxComponent.VAT, rate: new Prisma.Decimal("20"), effectiveFrom: new Date("2999-01-01T00:00:00Z") },
    ]);
  });

  function workspace(role: MembershipRole) {
    return {
      session: { user: { name: "Test" } },
      membership: { id: "membership-1", role },
      organization: { id: "org-1", name: "Shop", timezone: "Africa/Accra", currency: "GHS" },
      store: { id: "store-1", name: "Main" },
    };
  }

  it("shows tax setup and categories to owners using the business-date rates", async () => {
    getWorkspace.mockResolvedValue(workspace(MembershipRole.OWNER));
    const markup = renderToStaticMarkup(await SettingsPage());
    expect(getWorkspace).toHaveBeenCalledWith({
      allowedRoles: [MembershipRole.OWNER, MembershipRole.MANAGER],
      feature: "pos",
      operation: "view",
    });
    expect(markup).toContain("Tax setup");
    expect(markup).toContain("Category management");
    expect(taxForm).toHaveBeenCalledWith(expect.objectContaining({
      rates: { vat: "15.00", nhil: "0.00", getfund: "0.00" },
      history: expect.arrayContaining([expect.objectContaining({ component: "VAT", rate: "20.00", effectiveFrom: "2999-01-01" })]),
    }));
    expect(findTaxRates).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-1" } }));
  });

  it("shows managers tax setup without owner-only category management", async () => {
    getWorkspace.mockResolvedValue(workspace(MembershipRole.MANAGER));
    const markup = renderToStaticMarkup(await SettingsPage());
    expect(markup).toContain("Tax controls");
    expect(markup).not.toContain("Category management");
    expect(findCategories).not.toHaveBeenCalled();
  });
});
