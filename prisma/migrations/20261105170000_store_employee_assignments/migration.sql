CREATE TABLE "OrganizationStoreAssignment" (
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationStoreAssignment_pkey" PRIMARY KEY ("membershipId", "storeId")
);

CREATE UNIQUE INDEX "OrganizationMembership_organizationId_id_key"
ON "OrganizationMembership"("organizationId", "id");

CREATE INDEX "OrganizationStoreAssignment_organizationId_storeId_idx"
ON "OrganizationStoreAssignment"("organizationId", "storeId");

ALTER TABLE "OrganizationStoreAssignment"
ADD CONSTRAINT "OrganizationStoreAssignment_organizationId_membershipId_fkey"
FOREIGN KEY ("organizationId", "membershipId")
REFERENCES "OrganizationMembership"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationStoreAssignment"
ADD CONSTRAINT "OrganizationStoreAssignment_organizationId_storeId_fkey"
FOREIGN KEY ("organizationId", "storeId")
REFERENCES "Store"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "OrganizationStoreAssignment" ("organizationId", "membershipId", "storeId")
SELECT membership."organizationId", membership."id", store."id"
FROM "OrganizationMembership" AS membership
INNER JOIN "Store" AS store ON store."organizationId" = membership."organizationId";
