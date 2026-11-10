import { z } from "zod";

export const subscriptionPaymentSchema = z.object({
  organizationId: z.string().cuid(),
  packageId: z.enum(["starter", "growth", "pro"]),
  billingPeriod: z.enum(["MONTHLY", "ANNUAL"]),
  amount: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount with at most two decimal places.")
    .refine((value) => /[1-9]/.test(value), "The amount must be greater than zero."),
  reference: z.string().trim().min(1, "Enter a payment reference.").max(100).transform((value) => value.toUpperCase()),
  paidOn: z.iso.date().refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Enter a valid payment date."),
});

export const voidSubscriptionPaymentSchema = z.object({
  organizationId: z.string().cuid(),
  paymentId: z.string().cuid(),
  reason: z.string().trim().min(5, "Enter a reason of at least 5 characters.").max(500),
});
