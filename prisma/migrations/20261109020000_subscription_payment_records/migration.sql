CREATE TYPE "SubscriptionBillingPeriod" AS ENUM ('MONTHLY', 'ANNUAL');

CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "billingPeriod" "SubscriptionBillingPeriod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "reference" TEXT NOT NULL,
    "paidOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SubscriptionPayment_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "SubscriptionPayment_void_check" CHECK (
      ("voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL) OR
      ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND "voidReason" IS NOT NULL)
    )
);
CREATE UNIQUE INDEX "SubscriptionPayment_organizationId_reference_key" ON "SubscriptionPayment"("organizationId", "reference");
CREATE INDEX "SubscriptionPayment_organizationId_createdAt_idx" ON "SubscriptionPayment"("organizationId", "createdAt");
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SubscriptionPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "PlatformAdmin"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "PlatformAdmin"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
