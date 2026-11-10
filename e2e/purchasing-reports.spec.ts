import { expect, test, type Page } from "@playwright/test";

const password = "e2e-secure-password-1";

async function registerAndSignIn(page: Page, label: string) {
  const unique = `${Date.now()}-${label}`;
  const email = `e2e-${unique}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Business name").fill(`E2E Purchasing ${unique}`);
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

test("owner orders from a supplier, receives stock, cancels an order, then sees a sale in reports", async ({ page }, testInfo) => {
  const unique = await registerAndSignIn(page, `buy-${testInfo.project.name}`);
  const sku = `E2E-${unique}`.slice(0, 40).toUpperCase();

  await page.goto("/suppliers");
  await page.getByLabel("Business name").fill("E2E Wholesale Ltd");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.locator(".form-success")).toBeVisible();

  await page.goto("/products");
  await page.getByLabel("Product name").fill("E2E Cola");
  await page.getByLabel("SKU", { exact: true }).fill(sku);
  await page.getByLabel("Selling price · GHS").fill("12.50");
  await page.getByLabel("Opening stock").fill("5");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.locator(".form-success")).toBeVisible();

  await page.goto("/purchasing");
  await page.getByRole("combobox", { name: "Supplier", exact: true }).selectOption({ label: "E2E Wholesale Ltd" });
  await page.getByLabel("Purchase order product").selectOption({ index: 1 });
  await page.getByLabel("Quantity", { exact: true }).fill("20");
  await page.getByLabel(/^Unit cost/).fill("8");
  await page.getByRole("button", { name: "Create purchase order" }).click();
  await expect(page.locator(".form-success")).toBeVisible();

  const order = page.locator(".purchase-order-card").first();
  await expect(order).toContainText("E2E Wholesale Ltd");
  await expect(order).toContainText("0/20 received");
  await order.getByLabel("Receive E2E Cola").fill("20");
  await order.getByRole("button", { name: "Receive entered quantities" }).click();
  await expect(order).toContainText("20/20 received");

  await page.goto("/inventory?q=E2E%20Cola");
  await expect(page.getByRole("row", { name: /E2E Cola/ }).first()).toContainText("25");

  await page.goto("/purchasing");
  await page.getByRole("combobox", { name: "Supplier", exact: true }).selectOption({ label: "E2E Wholesale Ltd" });
  await page.getByLabel("Purchase order product").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Create purchase order" }).click();
  await expect(page.locator(".form-success")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel purchase order" }).first().click();
  await expect(page.locator(".purchase-order-card").first()).toContainText(/cancelled/i);

  await page.goto("/register-shifts");
  await page.getByRole("button", { name: "Open register shift" }).click();
  await expect(page.getByRole("button", { name: "Close register shift" })).toBeVisible();

  await page.goto("/pos");
  await page.getByLabel(/Search products by name/).fill("E2E Cola");
  await page.getByRole("button", { name: /E2E Cola/ }).click();
  await page.getByLabel("Quantity for E2E Cola").fill("2");
  await page.getByRole("button", { name: "Save as held cart" }).click();
  await page.getByRole("button", { name: "Complete sale" }).click();
  await expect(page.getByText(/Sale completed/)).toBeVisible();

  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports & insights" })).toBeVisible();
  const paidOrders = page.locator(".metric-card", { hasText: "Paid orders" });
  await expect(paidOrders.locator("strong")).toHaveText("1");
  await expect(page.locator(".metric-card", { hasText: /^Net sales/ }).locator("strong")).toContainText("25.00");
  await expect(page.getByRole("heading", { name: "Top products" })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="top-products-heading"]')).toContainText("E2E Cola");

  await page.getByLabel("Reporting period").selectOption("7");
  await page.getByRole("button", { name: "Update report" }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(page.locator(".metric-card", { hasText: "Paid orders" }).locator("strong")).toHaveText("1");
});
