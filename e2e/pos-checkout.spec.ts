import { expect, test, type Page } from "@playwright/test";

const password = "e2e-secure-password-1";

async function registerAndSignIn(page: Page, label: string) {
  const unique = `${Date.now()}-${label}`;
  const email = `e2e-${unique}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Business name").fill(`E2E Shop ${unique}`);
  await page.getByLabel("First store name").fill("Osu");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create business account" }).click();
  await expect(page).toHaveURL(/\/login\?registered=1/);

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return unique;
}

test("owner adds a product, opens a shift, sells it for cash and sees stock drop", async ({ page }, testInfo) => {
  const unique = await registerAndSignIn(page, `pos-${testInfo.project.name}`);
  const sku = `E2E-${unique}`.slice(0, 40).toUpperCase();

  await page.goto("/products");
  await page.getByLabel("Product name").fill("E2E Soap");
  await page.getByLabel("SKU", { exact: true }).fill(sku);
  await page.getByLabel("Selling price · GHS").fill("12.50");
  await page.getByLabel("Opening stock").fill("10");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.locator(".form-success")).toBeVisible();

  await page.goto("/register-shifts");
  await page.getByRole("button", { name: "Open register shift" }).click();
  await expect(page.getByRole("button", { name: "Close register shift" })).toBeVisible();

  await page.goto("/pos");
  await page.getByLabel(/Search products by name/).fill("E2E Soap");
  await page.getByRole("button", { name: /E2E Soap/ }).click();
  await page.getByLabel("Quantity for E2E Soap").fill("2");
  await page.getByRole("button", { name: "Save as held cart" }).click();
  await expect(page.getByRole("button", { name: "Complete sale" })).toBeVisible();

  await page.getByRole("button", { name: "Complete sale" }).click();
  await expect(page.getByText(/Sale completed/)).toBeVisible();

  await page.goto("/inventory?q=E2E%20Soap");
  await expect(page.getByRole("row", { name: /E2E Soap/ }).first()).toContainText("8");
});
