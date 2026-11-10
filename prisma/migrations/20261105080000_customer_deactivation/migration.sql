-- Preserve customer and order history while allowing inactive customers to be hidden from the active directory.
ALTER TABLE "Customer" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Customer_organizationId_archivedAt_idx" ON "Customer"("organizationId", "archivedAt");
