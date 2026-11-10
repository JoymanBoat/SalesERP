import { z } from "zod";

const organizationId = z.string().cuid();

export const subscriptionActivationSchema = z.discriminatedUnion("kind", [
  z.object({ organizationId, kind: z.literal("TRIAL") }),
  z.object({ organizationId, kind: z.literal("PAID"), paymentId: z.string().cuid() }),
]);
