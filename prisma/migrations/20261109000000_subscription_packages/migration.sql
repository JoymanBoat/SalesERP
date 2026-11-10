CREATE TABLE "SubscriptionPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "features" TEXT[] NOT NULL,
    "maxStores" INTEGER,
    "maxStaff" INTEGER,
    "monthlyPrice" DECIMAL(12,2),
    "annualPrice" DECIMAL(12,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionPackage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SubscriptionPackage_maxStores_check" CHECK ("maxStores" IS NULL OR "maxStores" > 0),
    CONSTRAINT "SubscriptionPackage_maxStaff_check" CHECK ("maxStaff" IS NULL OR "maxStaff" > 0),
    CONSTRAINT "SubscriptionPackage_monthlyPrice_check" CHECK ("monthlyPrice" IS NULL OR "monthlyPrice" >= 0),
    CONSTRAINT "SubscriptionPackage_annualPrice_check" CHECK ("annualPrice" IS NULL OR "annualPrice" >= 0)
);

ALTER TABLE "PlatformAuditEvent" ADD COLUMN "details" JSONB;

INSERT INTO "SubscriptionPackage" ("id", "name", "features", "maxStores", "maxStaff", "updatedAt")
VALUES
    ('starter', 'Starter', ARRAY['pos', 'inventory', 'customers'], 1, 2, CURRENT_TIMESTAMP),
    ('growth', 'Growth', ARRAY['pos', 'inventory', 'customers', 'suppliers', 'purchasing', 'reports'], 3, 10, CURRENT_TIMESTAMP),
    ('pro', 'Pro', ARRAY['pos', 'inventory', 'customers', 'suppliers', 'purchasing', 'reports', 'promotions', 'giftCards'], NULL, NULL, CURRENT_TIMESTAMP);
