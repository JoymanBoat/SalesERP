"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { prisma } from "@/lib/prisma";
import { addSubscriptionBillingPeriod, trialExpiresAt } from "@/lib/subscription-policy";
import { subscriptionActivationSchema } from "@/lib/subscription-activation-validation";
import { subscriptionPaymentSchema, voidSubscriptionPaymentSchema } from "@/lib/subscription-payment-validation";

export type PaymentActionState = { status: "idle" | "error" | "success"; message: string };

async function lockOrganization(transaction: Prisma.TransactionClient, organizationId: string) {
  const rows = await transaction.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) throw new Error("SUBSCRIPTION_TARGET_UNAVAILABLE");
}

export async function recordSubscriptionPayment(_previous: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const session = await requirePlatformAdmin();
  const parsed = subscriptionPaymentSchema.safeParse({
    organizationId: formData.get("organizationId"),
    packageId: formData.get("packageId"),
    billingPeriod: formData.get("billingPeriod"),
    amount: formData.get("amount"),
    reference: formData.get("reference"),
    paidOn: formData.get("paidOn"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the payment details." };
  const data = parsed.data;
  if (data.paidOn > new Date().toISOString().slice(0, 10)) {
    return { status: "error", message: "The payment date cannot be in the future (UTC)." };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      const [organization, selectedPackage] = await Promise.all([
        transaction.organization.findUnique({ where: { id: data.organizationId }, select: { id: true } }),
        transaction.subscriptionPackage.findUnique({ where: { id: data.packageId }, select: { name: true } }),
      ]);
      if (!organization || !selectedPackage) throw new Error("PAYMENT_TARGET_UNAVAILABLE");
      const payment = await transaction.subscriptionPayment.create({
        data: {
          organizationId: data.organizationId,
          packageId: data.packageId,
          packageName: selectedPackage.name,
          billingPeriod: data.billingPeriod,
          amount: data.amount,
          currency: "GHS",
          reference: data.reference,
          paidOn: new Date(`${data.paidOn}T00:00:00.000Z`),
          recordedById: session.user.id,
        },
        select: { id: true },
      });
      await transaction.platformAuditEvent.create({
        data: {
          actorId: session.user.id, organizationId: data.organizationId,
          action: "subscription_payment.recorded",
          details: { paymentId: payment.id, packageId: data.packageId, packageName: selectedPackage.name, billingPeriod: data.billingPeriod, amount: data.amount, currency: "GHS", reference: data.reference, paidOn: data.paidOn },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PAYMENT_TARGET_UNAVAILABLE") return { status: "error", message: "The business or package is no longer available." };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "error", message: "This payment reference is already recorded for this business, including voided records." };
    console.error("Subscription payment recording failed.", error);
    return { status: "error", message: "The payment could not be recorded. Please try again." };
  }
  revalidatePath(`/platform/businesses/${data.organizationId}/payments`);
  return { status: "success", message: "Payment recorded. No subscription was activated and access has not changed." };
}

export async function voidSubscriptionPayment(_previous: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const session = await requirePlatformAdmin();
  const parsed = voidSubscriptionPaymentSchema.safeParse({
    organizationId: formData.get("organizationId"),
    paymentId: formData.get("paymentId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the void details." };
  const data = parsed.data;
  try {
    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.subscriptionPayment.updateMany({
        where: { id: data.paymentId, organizationId: data.organizationId, voidedAt: null, activatedAt: null },
        data: { voidedAt: new Date(), voidedById: session.user.id, voidReason: data.reason },
      });
      if (result.count !== 1) return false;
      await transaction.platformAuditEvent.create({
        data: { actorId: session.user.id, organizationId: data.organizationId, action: "subscription_payment.voided", details: { paymentId: data.paymentId, reason: data.reason } },
      });
      return true;
    });
    if (!updated) return { status: "error", message: "This payment was already voided, activated, or is no longer available." };
  } catch (error) {
    console.error("Subscription payment void failed.", error);
    return { status: "error", message: "The payment could not be voided. Please try again." };
  }
  revalidatePath(`/platform/businesses/${data.organizationId}/payments`);
  return { status: "success", message: "Payment record voided. No money was refunded or moved." };
}

export async function activateSubscription(_previous: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const session = await requirePlatformAdmin();
  const kind = formData.get("kind");
  const parsed = subscriptionActivationSchema.safeParse({
    organizationId: formData.get("organizationId"),
    kind,
    ...(kind === "PAID" ? { paymentId: formData.get("paymentId") } : {}),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the activation details." };
  const data = parsed.data;

  try {
    await prisma.$transaction(async (transaction) => {
      await lockOrganization(transaction, data.organizationId);
      const now = new Date();
      const current = await transaction.organizationSubscription.findUnique({
        where: { organizationId: data.organizationId },
        select: { expiresAt: true },
      });

      if (data.kind === "TRIAL") {
        if (current) throw new Error("TRIAL_ALREADY_STARTED");
        const expiresAt = trialExpiresAt(now);
        await transaction.organizationSubscription.create({
          data: { organizationId: data.organizationId, kind: "TRIAL", expiresAt, packageId: null },
        });
        await transaction.platformAuditEvent.create({
          data: {
            actorId: session.user.id,
            organizationId: data.organizationId,
            action: "subscription.trial_activated",
            details: { startsAt: now.toISOString(), expiresAt: expiresAt.toISOString(), durationDays: 30 },
          },
        });
        return;
      }

      const payment = await transaction.subscriptionPayment.findFirst({
        where: { id: data.paymentId, organizationId: data.organizationId, voidedAt: null, activatedAt: null },
        select: {
          id: true, packageId: true, packageName: true, billingPeriod: true, amount: true, reference: true,
        },
      });
      if (!payment) throw new Error("PAYMENT_NOT_AVAILABLE");

      const startsAt = current && current.expiresAt > now ? current.expiresAt : now;
      const expiresAt = addSubscriptionBillingPeriod(startsAt, payment.billingPeriod);
      const activation = await transaction.subscriptionPayment.updateMany({
        where: { id: payment.id, organizationId: data.organizationId, voidedAt: null, activatedAt: null },
        data: { activatedAt: now, activatedById: session.user.id },
      });
      if (activation.count !== 1) throw new Error("PAYMENT_NOT_AVAILABLE");

      await transaction.organizationSubscription.upsert({
        where: { organizationId: data.organizationId },
        create: { organizationId: data.organizationId, kind: "PAID", packageId: payment.packageId, expiresAt },
        update: { kind: "PAID", packageId: payment.packageId, expiresAt },
      });
      await transaction.platformAuditEvent.create({
        data: {
          actorId: session.user.id,
          organizationId: data.organizationId,
          action: "subscription.paid_activated",
          details: {
            paymentId: payment.id,
            reference: payment.reference,
            packageId: payment.packageId,
            packageName: payment.packageName,
            billingPeriod: payment.billingPeriod,
            amount: payment.amount.toString(),
            startsAt: startsAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SUBSCRIPTION_TARGET_UNAVAILABLE") {
      return { status: "error", message: "This business is no longer available." };
    }
    if (error instanceof Error && error.message === "TRIAL_ALREADY_STARTED") {
      return { status: "error", message: "A subscription already exists for this business. Use a recorded payment to activate or renew a paid plan." };
    }
    if (error instanceof Error && error.message === "PAYMENT_NOT_AVAILABLE") {
      return { status: "error", message: "Choose an unused, non-voided payment recorded for this business." };
    }
    console.error("Subscription activation failed.", error);
    return { status: "error", message: "The subscription could not be activated. Please try again." };
  }

  revalidatePath(`/platform/businesses/${data.organizationId}/payments`);
  revalidatePath(`/platform/businesses/${data.organizationId}`);
  return {
    status: "success",
    message: data.kind === "TRIAL"
      ? "The 30-day trial is active. It cannot be started again for this business."
      : "The paid subscription is active. Its period starts now or extends from the current expiry.",
  };
}
