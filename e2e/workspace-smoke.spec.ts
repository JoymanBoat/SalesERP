import { expect, test } from "@playwright/test";

const password = "e2e-secure-password-1";

test("owner can open every main workspace page and download report exports", async ({ page }, testInfo) => {
  const unique = `${Date.now()}-smoke-${testInfo.project.name}`;
  const email = `e2e-${unique}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Business name").fill(`E2E Smoke ${unique}`);
  await page.getByLabel("First store name").fill("Osu");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create business account" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const pages = [
    "/products", "/inventory", "/customers", "/suppliers", "/purchasing", "/pos", "/pos/transactions",
    "/promotions", "/gift-cards", "/register-shifts", "/registers", "/reports", "/settings",
    "/stores", "/team", "/audit-logs", "/notifications", "/subscription",
  ];
  for (const path of pages) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBeLessThan(400);
    await expect(page, path).toHaveURL(new RegExp(path.replaceAll("/", "\\/")));
    await expect(page.locator("h1").first(), path).toBeVisible();
  }

  for (const path of ["/reports/export", "/reports/accounting-export", "/reports/tax-export", "/reports/supplier-invoice-aging", "/products/export", "/inventory/export", "/audit-logs/export"]) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toContain("text/csv");
  }
});
