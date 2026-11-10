CREATE TABLE "PosRegister" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosRegister_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosRegister_organizationId_storeId_id_key"
ON "PosRegister"("organizationId", "storeId", "id");

CREATE UNIQUE INDEX "PosRegister_storeId_name_key"
ON "PosRegister"("storeId", "name");

CREATE UNIQUE INDEX "PosRegister_storeId_code_key"
ON "PosRegister"("storeId", "code");

CREATE INDEX "PosRegister_organizationId_storeId_active_idx"
ON "PosRegister"("organizationId", "storeId", "active");

ALTER TABLE "PosRegister"
ADD CONSTRAINT "PosRegister_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PosRegister"
ADD CONSTRAINT "PosRegister_organizationId_storeId_fkey"
FOREIGN KEY ("organizationId", "storeId") REFERENCES "Store"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PosRegister" ("id", "organizationId", "storeId", "name", "code", "active", "createdAt", "updatedAt")
SELECT 'default-register-' || store."id", store."organizationId", store."id", 'Main register', 'MAIN', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Store" AS store;

CREATE TABLE "PosRegisterAssignment" (
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosRegisterAssignment_pkey" PRIMARY KEY ("membershipId", "registerId")
);

CREATE INDEX "PosRegisterAssignment_organizationId_storeId_registerId_idx"
ON "PosRegisterAssignment"("organizationId", "storeId", "registerId");

ALTER TABLE "PosRegisterAssignment"
ADD CONSTRAINT "PosRegisterAssignment_organizationId_membershipId_fkey"
FOREIGN KEY ("organizationId", "membershipId")
REFERENCES "OrganizationMembership"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PosRegisterAssignment"
ADD CONSTRAINT "PosRegisterAssignment_organizationId_storeId_registerId_fkey"
FOREIGN KEY ("organizationId", "storeId", "registerId")
REFERENCES "PosRegister"("organizationId", "storeId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PosRegisterAssignment" ("organizationId", "membershipId", "storeId", "registerId")
SELECT assignment."organizationId", assignment."membershipId", assignment."storeId", 'default-register-' || assignment."storeId"
FROM "OrganizationStoreAssignment" AS assignment;

ALTER TABLE "RegisterShift" ADD COLUMN "registerId" TEXT;

UPDATE "RegisterShift"
SET "registerId" = 'default-register-' || "storeId";

ALTER TABLE "RegisterShift" ALTER COLUMN "registerId" SET NOT NULL;

ALTER TABLE "RegisterShift"
ADD CONSTRAINT "RegisterShift_organizationId_storeId_registerId_fkey"
FOREIGN KEY ("organizationId", "storeId", "registerId")
REFERENCES "PosRegister"("organizationId", "storeId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "RegisterShift_registerId_openedAt_idx"
ON "RegisterShift"("registerId", "openedAt");

DROP INDEX "RegisterShift_one_open_per_store_key";

CREATE UNIQUE INDEX "RegisterShift_one_open_per_register_key"
ON "RegisterShift"("registerId")
WHERE "closedAt" IS NULL;
