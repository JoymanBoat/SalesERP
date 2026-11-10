import "dotenv/config";

import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Seeds one isolated synthetic business for load testing. Use `--cleanup` to remove it.
// Run only against a local or disposable database.
const email = "loadtest-owner@example.com";
const password = process.env.LOAD_TEST_PASSWORD ?? "load-test-password-1";
const slug = "load-test-business";
const products = Number(process.env.LOAD_PRODUCTS ?? 20000);
const customers = Number(process.env.LOAD_CUSTOMERS ?? 10000);
const orders = Number(process.env.LOAD_ORDERS ?? 50000);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function cleanup() {
  const organization = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  if (organization) {
    const id = organization.id;
    await prisma.$executeRaw`DELETE FROM "Payment" WHERE "orderId" IN (SELECT "id" FROM "Order" WHERE "organizationId" = ${id})`;
    await prisma.$executeRaw`DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT "id" FROM "Order" WHERE "organizationId" = ${id})`;
    await prisma.$executeRaw`DELETE FROM "Order" WHERE "organizationId" = ${id}`;
    await prisma.$executeRaw`DELETE FROM "InventoryMovement" WHERE "organizationId" = ${id}`;
    await prisma.$executeRaw`DELETE FROM "InventoryLevel" WHERE "organizationId" = ${id}`;
    await prisma.$executeRaw`DELETE FROM "ProductVariant" WHERE "organizationId" = ${id}`;
    await prisma.$executeRaw`DELETE FROM "Product" WHERE "organizationId" = ${id}`;
    await prisma.$executeRaw`DELETE FROM "Customer" WHERE "organizationId" = ${id}`;
    await prisma.organization.delete({ where: { id } });
  }
  await prisma.user.deleteMany({ where: { email } });
  console.log("Load-test data removed.");
}

async function seed() {
  if (await prisma.organization.findUnique({ where: { slug }, select: { id: true } })) {
    throw new Error("Load-test business already exists. Run with --cleanup first.");
  }
  const user = await prisma.user.create({
    data: { name: "Load Test Owner", email, passwordHash: await bcrypt.hash(password, 12), emailVerified: new Date() },
  });
  const organization = await prisma.organization.create({
    data: { name: "Load Test Business", slug, currency: "GHS", countryCode: "GH", timezone: "Africa/Accra" },
  });
  await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
  const store = await prisma.store.create({ data: { organizationId: organization.id, name: "Main", code: "MAIN" } });
  await prisma.posRegister.create({ data: { organizationId: organization.id, storeId: store.id, name: "Main register", code: "MAIN" } });
  const org = organization.id;
  const storeId = store.id;
  const started = Date.now();

  await prisma.$executeRaw`
    INSERT INTO "Product" ("id", "organizationId", "name", "updatedAt")
    SELECT 'lt-p-' || n, ${org}, 'Load product ' || n, NOW() FROM generate_series(1, ${products}) AS n`;
  await prisma.$executeRaw`
    INSERT INTO "ProductVariant" ("id", "organizationId", "productId", "sku", "barcode", "unitPrice", "updatedAt")
    SELECT 'lt-v-' || n, ${org}, 'lt-p-' || n, 'LT-' || n, '6' || lpad(n::text, 12, '0'), (n % 200) + 1.5, NOW()
    FROM generate_series(1, ${products}) AS n`;
  await prisma.$executeRaw`
    INSERT INTO "InventoryLevel" ("id", "organizationId", "storeId", "variantId", "quantity", "reorderPoint", "updatedAt")
    SELECT 'lt-i-' || n, ${org}, ${storeId}, 'lt-v-' || n, (n * 7) % 90, 10, NOW() FROM generate_series(1, ${products}) AS n`;
  await prisma.$executeRaw`
    INSERT INTO "Customer" ("id", "organizationId", "firstName", "lastName", "email", "phone", "updatedAt")
    SELECT 'lt-c-' || n, ${org}, 'Customer', 'No' || n, 'customer' || n || '@loadtest.example', '024' || lpad(n::text, 7, '0'), NOW()
    FROM generate_series(1, ${customers}) AS n`;
  await prisma.$executeRaw`
    INSERT INTO "Order" ("id", "organizationId", "storeId", "customerId", "number", "status", "subtotal", "total", "createdAt", "updatedAt")
    SELECT 'lt-o-' || n, ${org}, ${storeId}, 'lt-c-' || ((n % ${customers}) + 1), n, 'PAID', ((n % 50) + 5) * 2, ((n % 50) + 5) * 2,
           NOW() - (n % 90) * INTERVAL '1 day' - (n % 1440) * INTERVAL '1 minute', NOW()
    FROM generate_series(1, ${orders}) AS n`;
  await prisma.$executeRaw`
    INSERT INTO "OrderItem" ("id", "orderId", "variantId", "productName", "sku", "quantity", "unitPrice", "lineTotal")
    SELECT 'lt-oi-' || n, 'lt-o-' || n, 'lt-v-' || ((n % ${products}) + 1), 'Load product', 'LT-' || ((n % ${products}) + 1), 2, ((n % 50) + 5), ((n % 50) + 5) * 2
    FROM generate_series(1, ${orders}) AS n`;
  await prisma.$executeRaw`
    INSERT INTO "Payment" ("id", "orderId", "method", "status", "amount", "updatedAt")
    SELECT 'lt-pay-' || n, 'lt-o-' || n, 'CASH', 'SUCCEEDED', ((n % 50) + 5) * 2, NOW() FROM generate_series(1, ${orders}) AS n`;
  await prisma.$executeRaw`ANALYZE`;

  console.log(`Seeded ${products} products, ${customers} customers, ${orders} orders in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  console.log(`Sign in as ${email}.`);
}

try {
  if (process.argv.includes("--cleanup")) await cleanup();
  else await seed();
} finally {
  await prisma.$disconnect();
}
