CREATE TABLE "RegisterShift" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "closedById" TEXT,
    "openingCash" DECIMAL(12,2) NOT NULL,
    "closingCash" DECIMAL(12,2),
    "cashVariance" DECIMAL(12,2),
    "note" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "RegisterShift_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RegisterShift_openingCash_check" CHECK ("openingCash" >= 0),
    CONSTRAINT "RegisterShift_closingCash_check" CHECK ("closingCash" IS NULL OR "closingCash" >= 0),
    CONSTRAINT "RegisterShift_close_fields_check" CHECK (
        ("closedAt" IS NULL AND "closedById" IS NULL AND "closingCash" IS NULL AND "cashVariance" IS NULL)
        OR
        ("closedAt" IS NOT NULL AND "closedById" IS NOT NULL AND "closingCash" IS NOT NULL AND "cashVariance" IS NOT NULL)
    ),
    CONSTRAINT "RegisterShift_close_time_check" CHECK ("closedAt" IS NULL OR "closedAt" >= "openedAt")
);

CREATE UNIQUE INDEX "RegisterShift_one_open_per_store_key"
ON "RegisterShift"("storeId")
WHERE "closedAt" IS NULL;
CREATE INDEX "RegisterShift_organizationId_openedAt_idx" ON "RegisterShift"("organizationId", "openedAt");
CREATE INDEX "RegisterShift_storeId_openedAt_idx" ON "RegisterShift"("storeId", "openedAt");

ALTER TABLE "RegisterShift" ADD CONSTRAINT "RegisterShift_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RegisterShift" ADD CONSTRAINT "RegisterShift_storeId_fkey"
FOREIGN KEY ("organizationId", "storeId") REFERENCES "Store"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RegisterShift" ADD CONSTRAINT "RegisterShift_openedById_fkey"
FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RegisterShift" ADD CONSTRAINT "RegisterShift_closedById_fkey"
FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
