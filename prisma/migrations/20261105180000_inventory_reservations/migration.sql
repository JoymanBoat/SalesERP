CREATE UNIQUE INDEX "Order_organizationId_storeId_id_key"
ON "Order"("organizationId", "storeId", "id");

CREATE TABLE "InventoryReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryReservation_orderId_variantId_key"
ON "InventoryReservation"("orderId", "variantId");

CREATE INDEX "InventoryReservation_organizationId_storeId_variantId_idx"
ON "InventoryReservation"("organizationId", "storeId", "variantId");

ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_organizationId_storeId_orderId_fkey"
FOREIGN KEY ("organizationId", "storeId", "orderId")
REFERENCES "Order"("organizationId", "storeId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_storeId_variantId_fkey"
FOREIGN KEY ("storeId", "variantId")
REFERENCES "InventoryLevel"("storeId", "variantId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_variantId_fkey"
FOREIGN KEY ("variantId")
REFERENCES "ProductVariant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
