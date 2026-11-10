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

test("offline cart changes recover, sync as a held cart, and cannot be checked out before syncing", async ({ page }, testInfo) => {
  const unique = await registerAndSignIn(page, `offline-${testInfo.project.name}`);
  const sku = `E2E-${unique}`.slice(0, 40).toUpperCase();

  await page.goto("/products");
  await page.getByLabel("Product name").fill("E2E Offline Cart");
  await page.getByLabel("SKU", { exact: true }).fill(sku);
  await page.getByLabel("Selling price · GHS").fill("7.50");
  await page.getByLabel("Opening stock").fill("5");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.locator(".form-success")).toBeVisible();

  await page.goto("/register-shifts");
  await page.getByRole("button", { name: "Open register shift" }).click();
  await expect(page.getByRole("button", { name: "Close register shift" })).toBeVisible();

  await page.goto("/pos");
  await page.getByLabel(/Search products by name/).fill("E2E Offline Cart");
  await page.getByRole("button", { name: /E2E Offline Cart/ }).click();
  await expect(page.getByLabel("Quantity for E2E Offline Cart")).toHaveValue("1");
  await page.context().setOffline(true);
  await expect(page.getByText(/^Offline: unsynced cart changes are saved on this device/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as held cart" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Complete sale" })).toHaveCount(0);

  const storedCart = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("saleserp:pos-cart:v1:"));
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
  });
  expect(storedCart?.lines).toHaveLength(1);

  await page.context().setOffline(false);
  await page.goto("/pos");
  await expect(page.getByRole("button", { name: "Sync local cart as held cart" })).toBeEnabled();
  await expect(page.getByLabel("Quantity for E2E Offline Cart")).toHaveValue("1");
  await page.getByRole("button", { name: "Sync local cart as held cart" }).click();
  await expect(page.getByRole("button", { name: "Complete sale" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Update held cart" })).toBeVisible();

  await page.getByRole("button", { name: "Complete sale" }).click();
  await expect(page.getByText(/Sale completed/)).toBeVisible();
});

test("promotion and gift-card checkout supports refund, item return, and restocking", async ({ page }, testInfo) => {
  const unique = await registerAndSignIn(page, `retail-${testInfo.project.name}`);
  const sku = `E2E-${unique}`.slice(0, 40).toUpperCase();
  const promotionCode = `E2E${unique.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`.slice(0, 30);

  await page.goto("/products");
  await page.getByLabel("Product name").fill("E2E Gift Bundle");
  await page.getByLabel("SKU", { exact: true }).fill(sku);
  await page.getByLabel("Selling price · GHS").fill("100.00");
  await page.getByLabel("Opening stock").fill("3");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.locator(".form-success")).toBeVisible();

  await page.goto("/promotions");
  await page.getByLabel("Promotion name").fill("E2E Ten Percent");
  await page.getByLabel("Code").fill(promotionCode);
  await page.getByLabel("Discount type").selectOption("PERCENTAGE");
  await page.getByLabel("Discount value").fill("10");
  await page.getByRole("button", { name: "Create promotion" }).click();
  await expect(page.getByRole("row", { name: new RegExp(promotionCode) })).toBeVisible();

  await page.goto("/gift-cards");
  await page.getByLabel("Starting value (GHS)").fill("5");
  await page.getByRole("button", { name: "Issue gift card" }).click();
  const giftCardCode = (await page.locator(".gift-card-issued-code strong").textContent())?.trim();
  expect(giftCardCode).toBeTruthy();

  await page.goto("/register-shifts");
  await page.getByRole("button", { name: "Open register shift" }).click();
  await expect(page.getByRole("button", { name: "Close register shift" })).toBeVisible();

  await page.goto("/pos");
  await page.getByLabel(/Search products by name/).fill("E2E Gift Bundle");
  await page.getByRole("button", { name: /E2E Gift Bundle/ }).click();
  await page.getByLabel("Quantity for E2E Gift Bundle").fill("2");
  await page.getByLabel(/Promotion code/).fill(promotionCode);
  await page.getByLabel(/Apply gift card/).fill(giftCardCode!);
  await page.getByRole("button", { name: "Save as held cart" }).click();
  await expect(page.getByText(/Card ending/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete sale" })).toBeEnabled();
  await expect(page.getByLabel(/Cash received/)).toHaveValue("175.00");
  await page.getByRole("button", { name: "Complete sale" }).click();
  await expect(page.getByText(/Sale completed/)).toBeVisible();

  await page.goto("/pos/transactions?q=E2E%20Gift%20Bundle");
  const transaction = page.locator(".transaction-card").filter({ hasText: sku });
  await expect(transaction).toBeVisible();
  await transaction.getByText("Issue cash refund", { exact: true }).click();
  const refundDetails = transaction.locator("details").filter({ hasText: "Issue cash refund" });
  await refundDetails.getByLabel(/Amount to refund/).fill("10");
  await refundDetails.getByLabel("Reason", { exact: true }).fill("E2E partial refund");
  await refundDetails.getByRole("button", { name: "Record cash refund" }).click();
  await expect(refundDetails.getByRole("status")).toContainText("Refund recorded");

  await transaction.getByText("Return sale items", { exact: true }).click();
  const returnDetails = transaction.locator("details").filter({ hasText: "Return sale items" });
  await returnDetails.getByLabel("Qty").fill("1");
  await returnDetails.getByLabel("Restock").check();
  await returnDetails.getByLabel("Return reason").fill("E2E returned item");
  await returnDetails.getByRole("button", { name: "Return items and refund" }).click();
  await expect(returnDetails.getByRole("status")).toContainText("Sale return recorded");
  await expect(transaction).toContainText("1 returned");
  await expect(transaction).toContainText("Refunded");

  await page.goto("/inventory?q=E2E%20Gift%20Bundle");
  await expect(page.getByRole("row", { name: /E2E Gift Bundle/ }).first()).toContainText("2");

  const lastFour = giftCardCode!.slice(-4);
  await page.goto(`/gift-cards?q=${lastFour}`);
  const giftCardRow = page.getByRole("row", { name: new RegExp(lastFour) });
  await expect(giftCardRow).toBeVisible();
  await giftCardRow.getByText(/History/).click();
  await expect(giftCardRow).toContainText("Redeemed");
  await expect(giftCardRow).toContainText("Refunded");
});
