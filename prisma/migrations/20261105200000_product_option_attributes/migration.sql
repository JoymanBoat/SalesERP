CREATE UNIQUE INDEX "ProductVariant_organizationId_id_key"
ON "ProductVariant"("organizationId", "id");

CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductOption_organizationId_name_key"
ON "ProductOption"("organizationId", "name");

CREATE UNIQUE INDEX "ProductOption_organizationId_id_key"
ON "ProductOption"("organizationId", "id");

CREATE INDEX "ProductOption_organizationId_createdAt_idx"
ON "ProductOption"("organizationId", "createdAt");

ALTER TABLE "ProductOption"
ADD CONSTRAINT "ProductOption_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductVariantOption" (
    "organizationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ProductVariantOption_pkey" PRIMARY KEY ("variantId", "optionId")
);

CREATE INDEX "ProductVariantOption_organizationId_optionId_value_idx"
ON "ProductVariantOption"("organizationId", "optionId", "value");

ALTER TABLE "ProductVariantOption"
ADD CONSTRAINT "ProductVariantOption_organizationId_variantId_fkey"
FOREIGN KEY ("organizationId", "variantId")
REFERENCES "ProductVariant"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductVariantOption"
ADD CONSTRAINT "ProductVariantOption_organizationId_optionId_fkey"
FOREIGN KEY ("organizationId", "optionId")
REFERENCES "ProductOption"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
