CREATE TABLE "PromotionProduct" (
    "organizationId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "PromotionProduct_pkey" PRIMARY KEY ("promotionId", "productId")
);

CREATE INDEX "PromotionProduct_organizationId_productId_idx"
ON "PromotionProduct"("organizationId", "productId");

ALTER TABLE "PromotionProduct"
ADD CONSTRAINT "PromotionProduct_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PromotionProduct"
ADD CONSTRAINT "PromotionProduct_organizationId_promotionId_fkey"
FOREIGN KEY ("organizationId", "promotionId") REFERENCES "Promotion"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PromotionProduct"
ADD CONSTRAINT "PromotionProduct_organizationId_productId_fkey"
FOREIGN KEY ("organizationId", "productId") REFERENCES "Product"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
