CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'FIXED');

CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "PromotionType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Promotion_organizationId_code_key"
ON "Promotion"("organizationId", "code");

CREATE UNIQUE INDEX "Promotion_organizationId_id_key"
ON "Promotion"("organizationId", "id");

CREATE INDEX "Promotion_organizationId_active_createdAt_idx"
ON "Promotion"("organizationId", "active", "createdAt");

ALTER TABLE "Promotion"
ADD CONSTRAINT "Promotion_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order"
ADD COLUMN "promotionId" TEXT,
ADD COLUMN "promotionCode" TEXT;

CREATE INDEX "Order_organizationId_promotionId_idx"
ON "Order"("organizationId", "promotionId");

ALTER TABLE "Order"
ADD CONSTRAINT "Order_organizationId_promotionId_fkey"
FOREIGN KEY ("organizationId", "promotionId")
REFERENCES "Promotion"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
