import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test, type Browser, type Page } from "@playwright/test";

const password = "e2e-secure-password-1";
const run = `${Date.now()}`;
const adminEmail = `e2e-admin-${run}@example.com`;
const packageId = "starter";
const testOrganizationIds: string[] = [];
let originalFeatures: string[] | null = null;
let packageName = "Starter";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function registerBusiness(page: Page, label: string) {
  const email = `e2e-${label}-${run}@example.com`;
  const businessName = `E2E ${label} ${run}`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Business name").fill(businessName);
  await page.getByLabel("First store name").fill("Osu");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create business account" }).click();
  await expect(page).toHaveURL(/\/login\?registered=1/);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/dashboard/);
  const organization = await prisma.organization.findFirstOrThrow({ where: { name: businessName }, select: { id: true } });
  testOrganizationIds.push(organization.id);
  return organization.id;
}

async function adminPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, adminEmail);
  return { context, page };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: "E2E Platform Admin", email: adminEmail, passwordHash: await bcrypt.hash(password, 12), emailVerified: new Date() },
  });
  await prisma.platformAdmin.create({ data: { userId: user.id } });

  // Payments only accept the fixed package ids, so restrict starter for this run and restore it afterwards.
  const existing = await prisma.subscriptionPackage.findUnique({ where: { id: packageId } });
  originalFeatures = existing?.features ?? null;
  const limited = await prisma.subscriptionPackage.upsert({
    where: { id: packageId },
    create: { id: packageId, name: "Starter", features: ["pos"], maxStores: 1, maxStaff: 3 },
    update: { features: ["pos"] },
  });
  packageName = limited.name;
});

test.afterAll(async () => {
  const admin = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } });
  await prisma.organizationSubscription.deleteMany({ where: { organizationId: { in: testOrganizationIds } } });
  await prisma.subscriptionPayment.deleteMany({ where: { organizationId: { in: testOrganizationIds } } });
  if (originalFeatures) {
    await prisma.subscriptionPackage.update({ where: { id: packageId }, data: { features: originalFeatures } });
  } else {
    await prisma.subscriptionPackage.deleteMany({ where: { id: packageId } });
  }
  if (admin) {
    await prisma.platformAuditEvent.deleteMany({ where: { actorId: admin.id } });
    await prisma.platformAdmin.deleteMany({ where: { userId: admin.id } });
    await prisma.user.deleteMany({ where: { id: admin.id } });
  }
  await prisma.$disconnect();
});

test("admin starts a trial and the business sees it", async ({ page, browser }) => {
  const organizationId = await registerBusiness(page, "trial");
  const admin = await adminPage(browser);

  await admin.page.goto(`/platform/businesses/${organizationId}/payments`);
  await admin.page.getByRole("button", { name: "Start 30-day trial" }).click();
  await expect(admin.page.getByText(/Trial · Active/)).toBeVisible();
  await expect(admin.page.getByRole("button", { name: "Start 30-day trial" })).toHaveCount(0);
  await admin.context.close();

  await page.goto("/subscription");
  await expect(page.getByRole("heading", { name: "30-day trial" })).toBeVisible();
  await page.goto("/products");
  await expect(page).toHaveURL(/\/products/);
});

test("admin activates a limited paid plan and disabled features are blocked", async ({ page, browser }) => {
  const organizationId = await registerBusiness(page, "paid");
  const admin = await adminPage(browser);

  await admin.page.goto(`/platform/businesses/${organizationId}/payments`);
  await admin.page.getByLabel("Package").selectOption(packageId);
  await admin.page.getByLabel("Billing period").selectOption("MONTHLY");
  await admin.page.getByLabel("Amount received (GHS)").fill("10.00");
  await admin.page.getByLabel("Date received (UTC)").fill(new Date().toISOString().slice(0, 10));
  await admin.page.getByLabel("Payment reference").fill(`E2E-${run}`);
  await admin.page.getByRole("button", { name: "Record payment" }).click();
  await expect(admin.page.getByRole("cell", { name: `E2E-${run}` })).toBeVisible();

  await admin.page.locator('select[name="paymentId"]').selectOption({ index: 1 });
  await admin.page.getByRole("button", { name: "Activate paid plan" }).click();
  await expect(admin.page.getByText(new RegExp(`${packageName}.+Active`)).first()).toBeVisible();
  await expect(admin.page.getByText("Activated", { exact: true })).toBeVisible();
  await admin.context.close();

  await page.goto("/subscription");
  await expect(page.getByRole("heading", { name: /Starter/i })).toBeVisible();

  await page.goto("/products");
  await expect(page).toHaveURL(/\/subscription\?reason=feature&feature=inventory/);
  await expect(page.locator(".subscription-access-notice")).toContainText("not included");

  await page.goto("/pos");
  await expect(page).not.toHaveURL(/\/subscription/);
});
