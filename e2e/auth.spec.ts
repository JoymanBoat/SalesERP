import { expect, test } from "@playwright/test";

const password = "e2e-secure-password-1";

test("signed-out visitors are redirected to the login page, which stays stable", async ({ page }) => {
  await page.goto("/subscription");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // Guards against the reload loop reported on phones: no navigation should occur while idle.
  let navigations = 0;
  page.on("framenavigated", () => { navigations += 1; });
  await page.waitForTimeout(3000);
  expect(navigations).toBe(0);
});

test("rejects wrong credentials without leaving the login page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("nobody@example.com");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".form-error")).toContainText("incorrect");
  await expect(page).toHaveURL(/\/login/);
});

test("registers a business, signs in and reaches the dashboard and subscription page", async ({ page }, testInfo) => {
  const unique = `${Date.now()}-${testInfo.project.name}`;
  const email = `e2e-${unique}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Business name").fill(`E2E Shop ${unique}`);
  await page.getByLabel("First store name").fill("Osu");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create business account" }).click();

  await expect(page).toHaveURL(/\/login\?registered=1/);
  await expect(page.getByRole("status")).toContainText("ready");

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/subscription");
  await expect(page).toHaveURL(/\/subscription/);
});

test("email verification page handles an invalid link", async ({ page }) => {
  await page.goto(`/verify-email?token=${"x".repeat(30)}`);
  await page.getByRole("button", { name: "Verify my email" }).click();
  await expect(page.locator(".form-error")).toContainText("invalid or expired");
});
