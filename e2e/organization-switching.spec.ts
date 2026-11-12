import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

const password = "e2e-secure-password-1";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("owner can switch between two organization memberships", async ({ page }, testInfo) => {
  const unique = `${Date.now()}-${testInfo.project.name}`;
  const email = `e2e-org-switch-${unique}@example.com`;
  const firstOrganizationName = `E2E First Business ${unique}`;
  const secondOrganizationName = `E2E Second Business ${unique}`;

  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Business name").fill(firstOrganizationName);
  await page.getByLabel("First store name").fill("First Location");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create business account" }).click();
  await expect(page).toHaveURL(/\/login\?registered=1/);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const firstMembership = await prisma.organizationMembership.findFirstOrThrow({
    where: { userId: user.id },
    select: { organizationId: true },
  });
  const secondOrganization = await prisma.organization.create({
    data: {
      name: secondOrganizationName,
      slug: `e2e-org-switch-${unique}`,
      memberships: { create: { userId: user.id, role: "OWNER" } },
      stores: { create: { name: "Second Location", code: "SECOND" } },
    },
    select: { id: true },
  });

  await page.reload();
  await expect(page.locator("#active-organization")).toBeVisible();
  await expect(page.locator("[data-workspace-organization-id]"))
    .toHaveAttribute("data-workspace-organization-id", firstMembership.organizationId);
  await expect(page.locator(".store-switcher strong")).toHaveText(firstOrganizationName);

  await page.context().addCookies([
    { name: "saleserp-store-id", value: "stale-store", url: page.url() },
    { name: "saleserp-register-id", value: "stale-register", url: page.url() },
  ]);
  await page.locator("#active-organization").selectOption(secondOrganization.id);

  await expect(page.locator("[data-workspace-organization-id]"))
    .toHaveAttribute("data-workspace-organization-id", secondOrganization.id);
  await expect(page.locator(".store-switcher strong")).toHaveText(secondOrganizationName);
  await expect(page.locator(".store-switcher small")).toHaveText("Second Location");
  const switchedCookies = await page.context().cookies();
  expect(switchedCookies.find(({ name }) => name === "saleserp-organization-id")?.value)
    .toBe(secondOrganization.id);
  expect(switchedCookies.some(({ name }) => name === "saleserp-store-id")).toBe(false);
  expect(switchedCookies.some(({ name }) => name === "saleserp-register-id")).toBe(false);

  await page.locator("#active-organization").selectOption(firstMembership.organizationId);
  await expect(page.locator("[data-workspace-organization-id]"))
    .toHaveAttribute("data-workspace-organization-id", firstMembership.organizationId);
  await expect(page.locator(".store-switcher strong")).toHaveText(firstOrganizationName);
  await expect(page.locator(".store-switcher small")).toHaveText("First Location");
});
