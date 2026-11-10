CREATE TYPE "OrganizationSubscriptionKind" AS ENUM ('TRIAL', 'PAID');

CREATE TABLE "OrganizationSubscription" (
  "organizationId" TEXT NOT NULL,
  "kind" "OrganizationSubscriptionKind" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "packageId" TEXT,
  CONSTRAINT "OrganizationSubscription_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "OrganizationSubscription_package_check" CHECK (
    ("kind" = 'TRIAL' AND "packageId" IS NULL) OR
    ("kind" = 'PAID' AND "packageId" IS NOT NULL)
  ),
  CONSTRAINT "OrganizationSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrganizationSubscription_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SubscriptionPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
