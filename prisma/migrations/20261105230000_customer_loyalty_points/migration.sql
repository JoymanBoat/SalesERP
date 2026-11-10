CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARN', 'REDEEM', 'EARN_REVERSAL', 'REDEEM_REVERSAL');

ALTER TABLE "Customer"
ADD COLUMN "loyaltyPoints" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "Order"
ADD COLUMN "loyaltyPointsRedeemed" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "loyaltyPointsEarned" BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Customer_organizationId_id_key"
ON "Customer"("organizationId", "id");

CREATE UNIQUE INDEX "Order_organizationId_id_key"
ON "Order"("organizationId", "id");

CREATE UNIQUE INDEX "Refund_organizationId_id_key"
ON "Refund"("organizationId", "id");

CREATE TABLE "CustomerLoyaltyTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "refundId" TEXT,
    "type" "LoyaltyTransactionType" NOT NULL,
    "pointsDelta" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerLoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerLoyaltyTransaction_orderId_type_idx"
ON "CustomerLoyaltyTransaction"("orderId", "type");

CREATE UNIQUE INDEX "CustomerLoyaltyTransaction_refundId_type_key"
ON "CustomerLoyaltyTransaction"("refundId", "type");

CREATE INDEX "CustomerLoyaltyTransaction_organizationId_customerId_createdAt_idx"
ON "CustomerLoyaltyTransaction"("organizationId", "customerId", "createdAt");

ALTER TABLE "CustomerLoyaltyTransaction"
ADD CONSTRAINT "CustomerLoyaltyTransaction_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerLoyaltyTransaction"
ADD CONSTRAINT "CustomerLoyaltyTransaction_organizationId_customerId_fkey"
FOREIGN KEY ("organizationId", "customerId")
REFERENCES "Customer"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerLoyaltyTransaction"
ADD CONSTRAINT "CustomerLoyaltyTransaction_organizationId_orderId_fkey"
FOREIGN KEY ("organizationId", "orderId")
REFERENCES "Order"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerLoyaltyTransaction"
ADD CONSTRAINT "CustomerLoyaltyTransaction_organizationId_refundId_fkey"
FOREIGN KEY ("organizationId", "refundId")
REFERENCES "Refund"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
