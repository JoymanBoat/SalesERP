-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "organizationId" TEXT;

-- Backfill existing variants from their owning product before requiring the tenant key.
UPDATE "ProductVariant" AS variant
SET "organizationId" = product."organizationId"
FROM "Product" AS product
WHERE product."id" = variant."productId";

ALTER TABLE "ProductVariant" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_organizationId_sku_key" ON "ProductVariant"("organizationId", "sku");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
