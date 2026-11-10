CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Supplier_organizationId_businessName_idx" ON "Supplier"("organizationId", "businessName");
CREATE INDEX "Supplier_organizationId_archivedAt_idx" ON "Supplier"("organizationId", "archivedAt");
CREATE INDEX "Supplier_organizationId_email_idx" ON "Supplier"("organizationId", "email");
CREATE INDEX "Supplier_organizationId_phone_idx" ON "Supplier"("organizationId", "phone");

ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
