"use client";

export function ReceiptPrintButton() {
  return <button className="button-quiet receipt-print-button" type="button" onClick={() => window.print()}>Print receipt</button>;
}
