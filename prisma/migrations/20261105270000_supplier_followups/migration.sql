CREATE TYPE "SupplierContactMethod" AS ENUM ('PHONE', 'EMAIL', 'IN_PERSON', 'OTHER');

CREATE TABLE "SupplierFollowUp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "createdById" TEXT,
    "method" "SupplierContactMethod" NOT NULL,
    "summary" TEXT NOT NULL,
    "contactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followUpAt" TIMESTAMP(3),

    CONSTRAINT "SupplierFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierFollowUp_organizationId_storeId_purchaseOrderId_contactedAt_idx"
ON "SupplierFollowUp"("organizationId", "storeId", "purchaseOrderId", "contactedAt");

CREATE INDEX "SupplierFollowUp_organizationId_followUpAt_idx"
ON "SupplierFollowUp"("organizationId", "followUpAt");

ALTER TABLE "SupplierFollowUp"
ADD CONSTRAINT "SupplierFollowUp_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierFollowUp"
ADD CONSTRAINT "SupplierFollowUp_organizationId_storeId_fkey"
FOREIGN KEY ("organizationId", "storeId") REFERENCES "Store"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierFollowUp"
ADD CONSTRAINT "SupplierFollowUp_organizationId_storeId_purchaseOrderId_fkey"
FOREIGN KEY ("organizationId", "storeId", "purchaseOrderId") REFERENCES "PurchaseOrder"("organizationId", "storeId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierFollowUp"
ADD CONSTRAINT "SupplierFollowUp_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
