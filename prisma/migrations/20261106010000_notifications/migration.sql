CREATE TYPE "NotificationType" AS ENUM (
    'LOW_STOCK',
    'SUPPLIER_FOLLOW_UP',
    'SUPPLIER_INVOICE_OVERDUE',
    'SUPPLIER_INVOICE_DUE_SOON',
    'DAILY_SALES_SUMMARY'
);

CREATE TABLE "InAppNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "emailAttemptAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "emailSuppressedAt" TIMESTAMP(3),

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InAppNotification_membershipId_eventKey_key"
    ON "InAppNotification"("membershipId", "eventKey");
CREATE INDEX "notifications_inbox_idx"
    ON "InAppNotification"("organizationId", "storeId", "membershipId", "readAt", "createdAt");
CREATE INDEX "InAppNotification_emailSentAt_emailAttemptAt_idx"
    ON "InAppNotification"("emailSentAt", "emailAttemptAt");

ALTER TABLE "InAppNotification"
    ADD CONSTRAINT "InAppNotification_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InAppNotification"
    ADD CONSTRAINT "InAppNotification_organizationId_storeId_fkey"
    FOREIGN KEY ("organizationId", "storeId") REFERENCES "Store"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InAppNotification"
    ADD CONSTRAINT "InAppNotification_organizationId_membershipId_fkey"
    FOREIGN KEY ("organizationId", "membershipId") REFERENCES "OrganizationMembership"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
