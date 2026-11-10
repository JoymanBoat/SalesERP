-- Configurable tax components and product tax treatments. Only tax objects are changed.

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'RELIEVED');

-- CreateEnum
CREATE TYPE "TaxComponent" AS ENUM ('VAT', 'NHIL', 'GETFUND');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "taxTreatment" "TaxTreatment" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "Order"
  ADD COLUMN "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "nhilRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "getfundRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "vatTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "nhilTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "getfundTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxComponentsRecorded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderItem"
  ADD COLUMN "taxTreatment" "TaxTreatment" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "nhilAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "getfundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TaxRateSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "component" "TaxComponent" NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRateSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxRateSetting_organizationId_component_effectiveFrom_key" ON "TaxRateSetting"("organizationId", "component", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TaxRateSetting_organizationId_component_effectiveFrom_idx" ON "TaxRateSetting"("organizationId", "component", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "TaxRateSetting" ADD CONSTRAINT "TaxRateSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: a previously configured single checkout rate keeps applying, recorded as a VAT-labelled
-- history row dated 2000-01-01 so owners can review and replace it. Organizations at 0% get no row.
INSERT INTO "TaxRateSetting" ("id", "organizationId", "component", "rate", "effectiveFrom")
SELECT 'legacy_vat_' || "id", "id", 'VAT', "taxRate", DATE '2000-01-01'
FROM "Organization"
WHERE "taxRate" > 0;

-- Existing orders keep their saved combined taxRate/taxTotal untouched. Their component split was
-- never recorded, so component columns stay 0 and taxComponentsRecorded stays false.