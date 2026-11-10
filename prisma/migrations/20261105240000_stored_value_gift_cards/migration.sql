CREATE TYPE "GiftCardTransactionType" AS ENUM ('ISSUE', 'REDEEM', 'REFUND');

ALTER TABLE "Order"
ADD COLUMN "giftCardId" TEXT,
ADD COLUMN "giftCardRedeemed" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "Refund"
ADD COLUMN "cashRefundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "Refund" SET "cashRefundAmount" = "amount";

CREATE TABLE "GiftCard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeLastFour" TEXT NOT NULL,
    "initialBalance" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiftCardTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "orderId" TEXT,
    "refundId" TEXT,
    "type" "GiftCardTransactionType" NOT NULL,
    "amountDelta" DECIMAL(12,2) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCardTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GiftCard_organizationId_codeHash_key"
ON "GiftCard"("organizationId", "codeHash");

CREATE UNIQUE INDEX "GiftCard_organizationId_id_key"
ON "GiftCard"("organizationId", "id");

CREATE INDEX "GiftCard_organizationId_active_createdAt_idx"
ON "GiftCard"("organizationId", "active", "createdAt");

CREATE UNIQUE INDEX "GiftCardTransaction_orderId_giftCardId_type_key"
ON "GiftCardTransaction"("orderId", "giftCardId", "type");

CREATE UNIQUE INDEX "GiftCardTransaction_refundId_giftCardId_type_key"
ON "GiftCardTransaction"("refundId", "giftCardId", "type");

CREATE INDEX "GiftCardTransaction_organizationId_giftCardId_createdAt_idx"
ON "GiftCardTransaction"("organizationId", "giftCardId", "createdAt");

ALTER TABLE "GiftCard"
ADD CONSTRAINT "GiftCard_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GiftCardTransaction"
ADD CONSTRAINT "GiftCardTransaction_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GiftCardTransaction"
ADD CONSTRAINT "GiftCardTransaction_organizationId_giftCardId_fkey"
FOREIGN KEY ("organizationId", "giftCardId")
REFERENCES "GiftCard"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiftCardTransaction"
ADD CONSTRAINT "GiftCardTransaction_orderId_fkey"
FOREIGN KEY ("organizationId", "orderId") REFERENCES "Order"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiftCardTransaction"
ADD CONSTRAINT "GiftCardTransaction_refundId_fkey"
FOREIGN KEY ("organizationId", "refundId") REFERENCES "Refund"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Order"
ADD CONSTRAINT "Order_organizationId_giftCardId_fkey"
FOREIGN KEY ("organizationId", "giftCardId")
REFERENCES "GiftCard"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
