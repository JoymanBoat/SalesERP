import { describe, expect, it } from "vitest";

import { purchaseOrderIsOverdue, supplierFollowUpIsDue } from "./purchasing";

describe("purchase order overdue status", () => {
  const today = "2026-11-05";

  it("marks open orders overdue only after their expected date", () => {
    expect(purchaseOrderIsOverdue("ORDERED", new Date("2026-11-04T00:00:00.000Z"), today)).toBe(true);
    expect(purchaseOrderIsOverdue("PARTIALLY_RECEIVED", new Date("2026-11-04T00:00:00.000Z"), today)).toBe(true);
    expect(purchaseOrderIsOverdue("ORDERED", new Date("2026-11-05T00:00:00.000Z"), today)).toBe(false);
    expect(purchaseOrderIsOverdue("ORDERED", new Date("2026-11-06T00:00:00.000Z"), today)).toBe(false);
  });

  it("does not mark complete, cancelled, or undated orders overdue", () => {
    const yesterday = new Date("2026-11-04T00:00:00.000Z");
    expect(purchaseOrderIsOverdue("RECEIVED", yesterday, today)).toBe(false);
    expect(purchaseOrderIsOverdue("CANCELLED", yesterday, today)).toBe(false);
    expect(purchaseOrderIsOverdue("ORDERED", null, today)).toBe(false);
    expect(purchaseOrderIsOverdue("ORDERED", yesterday, "invalid")).toBe(false);
  });

  it("treats a scheduled follow-up as due on its date in the business calendar", () => {
    expect(supplierFollowUpIsDue("ORDERED", new Date("2026-11-04T00:00:00.000Z"), today)).toBe(true);
    expect(supplierFollowUpIsDue("PARTIALLY_RECEIVED", new Date("2026-11-05T00:00:00.000Z"), today)).toBe(true);
    expect(supplierFollowUpIsDue("ORDERED", new Date("2026-11-06T00:00:00.000Z"), today)).toBe(false);
    expect(supplierFollowUpIsDue("ORDERED", null, today)).toBe(false);
    expect(supplierFollowUpIsDue("RECEIVED", new Date("2026-11-04T00:00:00.000Z"), today)).toBe(false);
    expect(supplierFollowUpIsDue("CANCELLED", new Date("2026-11-04T00:00:00.000Z"), today)).toBe(false);
    expect(supplierFollowUpIsDue("ORDERED", new Date("2026-11-05T00:00:00.000Z"), "invalid")).toBe(false);
  });
});
