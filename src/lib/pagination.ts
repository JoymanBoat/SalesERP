export function parsePage(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function getPageCount(total: number, pageSize: number) {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError("Pagination totals and page size must be non-negative and positive integers.");
  }
  return Math.max(1, Math.ceil(total / pageSize));
}
