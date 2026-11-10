import { z } from "zod";

import { SUBSCRIPTION_FEATURES } from "@/lib/subscription-policy";

const limit = z.string().trim().refine(
  (value) => value === "" || (/^[1-9]\d{0,5}$/.test(value) && Number(value) <= 100000),
  "Enter a whole number between 1 and 100000, or leave blank for unlimited.",
).transform((value) => value === "" ? null : Number(value));

const price = z.string().trim().refine(
  (value) => value === "" || /^\d{1,10}(\.\d{1,2})?$/.test(value),
  "Enter a non-negative GHS amount with at most two decimal places, or leave blank.",
).transform((value) => value === "" ? null : value);

export const packageConfigurationSchema = z.object({
  id: z.enum(["starter", "growth", "pro"]),
  revision: z.string().regex(/^(0|[1-9]\d{0,8})$/, "Invalid package revision.").transform(Number),
  features: z.array(z.enum(SUBSCRIPTION_FEATURES)).refine(
    (features) => new Set(features).size === features.length,
    "Each feature can only be selected once.",
  ),
  maxStores: limit,
  maxStaff: limit,
  monthlyPrice: price,
  annualPrice: price,
});
