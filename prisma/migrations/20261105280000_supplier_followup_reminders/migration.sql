ALTER TABLE "PurchaseOrder"
ADD COLUMN "nextFollowUpAt" TIMESTAMP(3);

CREATE INDEX "PurchaseOrder_organizationId_storeId_status_nextFollowUpAt_idx"
ON "PurchaseOrder"("organizationId", "storeId", "status", "nextFollowUpAt");
