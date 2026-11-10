import { expect, test } from "@playwright/test";

test("owner generates SKUs and creates a previewed variant batch", async ({ page }, testInfo) => {
  const unique = `${Date.now()}-${testInfo.project.name}`;
  const email = `e2e-variants-${unique}@example.com`;
  const password = "e2e-secure-password-1";
  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Business name").fill(`E2E Variants ${unique}`);
  await page.getByLabel("First store name").fill("Main");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create business account" }).click();
  await expect(page).toHaveURL(/\/login\?registered=1/);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/products");
  await page.getByLabel("Option name").fill("Size");
  await page.getByRole("button", { name: "Add option" }).click();
  await expect(page.getByText("Size", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Product name").fill("E2E Shirt");
  await page.getByLabel("Selling price · GHS").fill("10");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText("E2E Shirt was added to your catalog.")).toBeVisible();
  await page.getByText("Manage variants (1)").click();
  const batch = page.locator("form").filter({ hasText: "Generate variants" });
  await batch.getByLabel("Size").fill("Small, Large");
  await expect(batch.getByText("Preview: 2 variants")).toBeVisible();
  await batch.getByLabel("Price · GHS").fill("12");
  await batch.getByRole("button", { name: "Create variants" }).click();
  await expect(batch.getByText("2 variants created with generated SKUs and zero opening stock.")).toBeVisible();
  await expect(page.getByText("Manage variants (3)")).toBeVisible();
  await expect(page.locator(".product-variant-editor strong").filter({ hasText: /^Small · VAR-/ })).toBeVisible();
  await expect(page.locator(".product-variant-editor strong").filter({ hasText: /^Large · VAR-/ })).toBeVisible();
});
