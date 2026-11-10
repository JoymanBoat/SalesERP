ALTER TYPE "InventoryMovementType" ADD VALUE 'SUPPLIER_RETURN';

CREATE TABLE "SupplierReturn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "createdById" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierReturn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierReturnItem" (
    "id" TEXT NOT NULL,
    "supplierReturnId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SupplierReturnItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierReturnItem_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "SupplierReturnItem_unitCost_check" CHECK ("unitCost" >= 0)
);

CREATE INDEX "SupplierReturn_organizationId_createdAt_idx" ON "SupplierReturn"("organizationId", "createdAt");
CREATE INDEX "SupplierReturn_storeId_createdAt_idx" ON "SupplierReturn"("storeId", "createdAt");
CREATE INDEX "SupplierReturn_purchaseOrderId_createdAt_idx" ON "SupplierReturn"("purchaseOrderId", "createdAt");
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_id_key" ON "PurchaseOrder"("organizationId", "id");
CREATE UNIQUE INDEX "SupplierReturnItem_supplierReturnId_purchaseOrderItemId_key" ON "SupplierReturnItem"("supplierReturnId", "purchaseOrderItemId");
CREATE INDEX "SupplierReturnItem_purchaseOrderItemId_idx" ON "SupplierReturnItem"("purchaseOrderItemId");

ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_storeId_fkey"
FOREIGN KEY ("organizationId", "storeId") REFERENCES "Store"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_purchaseOrderId_fkey"
FOREIGN KEY ("organizationId", "purchaseOrderId") REFERENCES "PurchaseOrder"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnItem" ADD CONSTRAINT "SupplierReturnItem_supplierReturnId_fkey"
FOREIGN KEY ("supplierReturnId") REFERENCES "SupplierReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnItem" ADD CONSTRAINT "SupplierReturnItem_purchaseOrderItemId_fkey"
FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
