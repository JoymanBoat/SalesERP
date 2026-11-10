import { describe, expect, it } from "vitest";
import { MembershipRole, NotificationType } from "@prisma/client";

import { getVisibleNotificationTypes } from "./permissions";

describe("getVisibleNotificationTypes", () => {
  it("limits notification content to role permissions", () => {
    expect(getVisibleNotificationTypes(MembershipRole.CASHIER)).toEqual([]);
    expect(getVisibleNotificationTypes(MembershipRole.INVENTORY_MANAGER)).toEqual([
      NotificationType.LOW_STOCK,
      NotificationType.SUPPLIER_FOLLOW_UP,
    ]);
    expect(getVisibleNotificationTypes(MembershipRole.ACCOUNTANT)).toEqual([
      NotificationType.SUPPLIER_INVOICE_OVERDUE,
      NotificationType.SUPPLIER_INVOICE_DUE_SOON,
    ]);
    expect(getVisibleNotificationTypes(MembershipRole.MANAGER)).toEqual([
      NotificationType.LOW_STOCK,
      NotificationType.SUPPLIER_FOLLOW_UP,
      NotificationType.SUPPLIER_INVOICE_OVERDUE,
      NotificationType.SUPPLIER_INVOICE_DUE_SOON,
      NotificationType.DAILY_SALES_SUMMARY,
    ]);
  });
});
