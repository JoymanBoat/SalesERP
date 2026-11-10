import { z } from "zod";

const employeeRoles = [
  "MANAGER",
  "CASHIER",
  "INVENTORY_MANAGER",
  "ACCOUNTANT",
  "CUSTOMER_SUPPORT",
] as const;

export const employeeInvitationSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(employeeRoles),
  storeIds: z.array(z.string().cuid()).min(1).max(100)
    .refine((values) => new Set(values).size === values.length, "A store can only be selected once."),
  registerIds: z.array(z.string().cuid()).max(100)
    .refine((values) => new Set(values).size === values.length, "A register can only be selected once."),
});

export const acceptEmployeeInvitationSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This invitation link is invalid or expired."),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(128),
});
