ALTER TABLE "Organization"
ADD COLUMN "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD CONSTRAINT "Organization_taxRate_check" CHECK ("taxRate" >= 0 AND "taxRate" <= 100);

ALTER TABLE "Order"
ADD COLUMN "registerShiftId" TEXT,
ADD COLUMN "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN "notes" TEXT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_taxRate_check" CHECK ("taxRate" >= 0 AND "taxRate" <= 100);
CREATE INDEX "Order_registerShiftId_idx" ON "Order"("registerShiftId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_registerShiftId_fkey"
FOREIGN KEY ("registerShiftId") REFERENCES "RegisterShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
ADD COLUMN "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "Payment"
ADD COLUMN "cashReceived" DECIMAL(12,2),
ADD COLUMN "changeGiven" DECIMAL(12,2);

ALTER TABLE "RegisterShift"
ADD COLUMN "expectedCash" DECIMAL(12,2),
ADD COLUMN "cashSales" DECIMAL(12,2),
ADD COLUMN "cashRefunds" DECIMAL(12,2);
UPDATE "RegisterShift"
SET "expectedCash" = "openingCash", "cashSales" = 0, "cashRefunds" = 0
WHERE "closedAt" IS NOT NULL;
ALTER TABLE "RegisterShift"
ADD CONSTRAINT "RegisterShift_cash_reconciliation_check"
CHECK (
  ("closedAt" IS NULL AND "expectedCash" IS NULL AND "cashSales" IS NULL AND "cashRefunds" IS NULL)
  OR
  ("closedAt" IS NOT NULL AND "expectedCash" IS NOT NULL AND "cashSales" IS NOT NULL AND "cashRefunds" IS NOT NULL)
);

CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "registerShiftId" TEXT,
    "createdById" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Refund_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "SaleReturn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "createdById" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleReturnItem" (
    "id" TEXT NOT NULL,
    "saleReturnId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "restocked" BOOLEAN NOT NULL DEFAULT false,
    "refunded" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SaleReturnItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SaleReturnItem_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "SaleReturnItem_refunded_check" CHECK ("refunded" >= 0)
);

CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");
CREATE UNIQUE INDEX "SaleReturn_refundId_key" ON "SaleReturn"("refundId");
CREATE UNIQUE INDEX "SaleReturnItem_saleReturnId_orderItemId_key" ON "SaleReturnItem"("saleReturnId", "orderItemId");
CREATE INDEX "Refund_organizationId_createdAt_idx" ON "Refund"("organizationId", "createdAt");
CREATE INDEX "Refund_storeId_createdAt_idx" ON "Refund"("storeId", "createdAt");
CREATE INDEX "Refund_orderId_createdAt_idx" ON "Refund"("orderId", "createdAt");
CREATE INDEX "SaleReturn_organizationId_createdAt_idx" ON "SaleReturn"("organizationId", "createdAt");
CREATE INDEX "SaleReturn_storeId_createdAt_idx" ON "SaleReturn"("storeId", "createdAt");
CREATE INDEX "SaleReturn_orderId_createdAt_idx" ON "SaleReturn"("orderId", "createdAt");
CREATE INDEX "SaleReturnItem_orderItemId_idx" ON "SaleReturnItem"("orderItemId");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_storeId_fkey"
FOREIGN KEY ("organizationId", "storeId") REFERENCES "Store"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_registerShiftId_fkey"
FOREIGN KEY ("registerShiftId") REFERENCES "RegisterShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_storeId_fkey"
FOREIGN KEY ("organizationId", "storeId") REFERENCES "Store"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_refundId_fkey"
FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleReturnId_fkey"
FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_orderItemId_fkey"
FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
