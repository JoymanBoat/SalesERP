import { describe, expect, it } from "vitest";

import { acceptEmployeeInvitationSchema, employeeInvitationSchema } from "./invitation-validation";

describe("employee invitation validation", () => {
  const storeId = "clh1p2s3t0000qwertyuiopas";
  const registerId = "clh1p2s3t0001qwertyuiopas";

  it("normalizes the invited email and rejects duplicate assignments", () => {
    expect(employeeInvitationSchema.parse({
      email: " Employee@Example.com ",
      role: "CASHIER",
      storeIds: [storeId],
      registerIds: [registerId],
    })).toMatchObject({ email: "employee@example.com" });

    expect(employeeInvitationSchema.safeParse({
      email: "employee@example.com",
      role: "CASHIER",
      storeIds: [storeId, storeId],
      registerIds: [],
    }).success).toBe(false);
  });

  it("requires a bounded password and a 32-byte URL-safe token", () => {
    expect(acceptEmployeeInvitationSchema.safeParse({
      token: "A".repeat(43),
      name: "Ama Mensah",
      password: "a-secure-password",
    }).success).toBe(true);
    expect(acceptEmployeeInvitationSchema.safeParse({
      token: "too-short",
      name: "Ama Mensah",
      password: "short",
    }).success).toBe(false);
  });
});
