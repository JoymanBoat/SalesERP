ALTER TABLE "SubscriptionPayment"
  ADD COLUMN "activatedAt" TIMESTAMP(3),
  ADD COLUMN "activatedById" TEXT;

ALTER TABLE "SubscriptionPayment"
  ADD CONSTRAINT "SubscriptionPayment_activatedById_fkey"
  FOREIGN KEY ("activatedById") REFERENCES "PlatformAdmin"("userId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionPayment"
  ADD CONSTRAINT "SubscriptionPayment_activation_fields_check"
  CHECK (("activatedAt" IS NULL) = ("activatedById" IS NULL));
