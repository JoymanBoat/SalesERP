export function quantityToReachReorderPoint(available: number, reorderPoint: number) {
  if (
    !Number.isSafeInteger(available) ||
    available < 0 ||
    !Number.isSafeInteger(reorderPoint) ||
    reorderPoint < 0
  ) {
    throw new RangeError("Inventory quantities must be non-negative safe integers.");
  }
  return Math.max(0, reorderPoint - available);
}

export function parseRestockQuantity(value: string | undefined) {
  if (!value || !/^[1-9]\d{0,6}$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity <= 1_000_000 ? quantity : null;
}
