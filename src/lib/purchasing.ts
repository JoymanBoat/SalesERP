const openPurchaseOrderStatuses = new Set(["ORDERED", "PARTIALLY_RECEIVED"]);

export function purchaseOrderIsOverdue(status: string, expectedAt: Date | null, businessDate: string) {
  if (!openPurchaseOrderStatuses.has(status) || !expectedAt || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    return false;
  }
  return expectedAt.toISOString().slice(0, 10) < businessDate;
}

export function supplierFollowUpIsDue(
  status: string,
  nextFollowUpAt: Date | null,
  businessDate: string,
) {
  if (!openPurchaseOrderStatuses.has(status) || !nextFollowUpAt || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    return false;
  }
  return nextFollowUpAt.toISOString().slice(0, 10) <= businessDate;
}
