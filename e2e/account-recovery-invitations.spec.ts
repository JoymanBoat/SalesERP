import "dotenv/config";

import { createHash, randomBytes } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

const password = "e2e-secure-password-1";
const newPassword = "e2e-changed-password-2";
const run = `${Date.now()}`;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token).digest("hex") };
}

async function register(page: Page, label: string) {
  const email = `e2e-${label}-${run}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Business name").fill(`E2E ${label} ${run}`);
  await page.getByLabel("First store name").fill("Osu");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create business account" }).click();
  await expect(page).toHaveURL(/\/login\?registered=1/);
  return email;
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("password reset sets a new password and rejects reuse of the link", async ({ page }, testInfo) => {
  const email = await register(page, `reset-${testInfo.project.name}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const { token, tokenHash } = newToken();
  await prisma.authToken.create({
    data: { userId: user.id, tokenHash, type: "PASSWORD_RESET", expiresAt: new Date(Date.now() + 30 * 60_000) },
  });

  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel(/^New password/).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).toHaveURL(/\/login\?reset=1/);

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".form-error")).toContainText("incorrect");

  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel(/^New password/).fill(`${newPassword}-again`);
  await page.getByLabel("Confirm new password").fill(`${newPassword}-again`);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.locator(".form-error")).toContainText("invalid or expired");
});

test("password reset rejects mismatched passwords", async ({ page }) => {
  await page.goto(`/reset-password?token=${"y".repeat(43)}`);
  await page.getByLabel(/^New password/).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(`${newPassword}x`);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.locator(".form-error")).toContainText("do not match");
});

test("an invited employee accepts, signs in with their role and cannot reuse the link", async ({ page }, testInfo) => {
  const label = `invite-${testInfo.project.name}`;
  const ownerEmail = await register(page, label);
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail }, select: { id: true } });
  const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { userId: owner.id }, select: { organizationId: true } });
  const store = await prisma.store.findFirstOrThrow({ where: { organizationId: membership.organizationId }, select: { id: true } });
  const employeeEmail = `e2e-employee-${label}-${run}@example.com`;
  const { token, tokenHash } = newToken();
  await prisma.employeeInvitation.create({
    data: {
      organizationId: membership.organizationId,
      invitedById: owner.id,
      email: employeeEmail,
      role: "CASHIER",
      storeIds: [store.id],
      registerIds: [],
      tokenHash,
      expiresAt: new Date(Date.now() + 72 * 3_600_000),
    },
  });

  await page.goto(`/accept-invitation?token=${token}`);
  await page.getByLabel("Your name").fill("E2E Cashier");
  await page.getByLabel("Create a password").fill(password);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(/\/login\?invited=1/);

  await page.getByLabel("Email address").fill(employeeEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Cashiers cannot manage the team: the owner-only page must not offer employee administration.
  await page.goto("/team");
  await expect(page.getByRole("button", { name: /add employee|send invitation/i })).toHaveCount(0);

  const verified = await prisma.user.findUniqueOrThrow({ where: { email: employeeEmail }, select: { emailVerified: true } });
  expect(verified.emailVerified).not.toBeNull();

  await page.context().clearCookies();
  await page.goto(`/accept-invitation?token=${token}`);
  await page.getByLabel("Your name").fill("E2E Cashier Again");
  await page.getByLabel("Create a password").fill(password);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.locator(".form-error")).toContainText("invalid or expired");
});
