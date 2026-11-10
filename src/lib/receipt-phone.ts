export function normalizeReceiptPhone(value: string) {
  const cleaned = value.replace(/[\s()-]/g, "");
  const international = cleaned.startsWith("0") ? `233${cleaned.slice(1)}` : cleaned.replace(/^\+/, "");
  return /^[1-9]\d{7,14}$/.test(international) ? international : null;
}
