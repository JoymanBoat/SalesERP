import { describe, expect, it } from "vitest";

import {
  buildSupplierInvoiceAgingCsv,
  buildSupplierInvoiceAgingDetailsCsv,
  summarizeSupplierInvoiceAging,
} from "./supplier-invoice-aging-csv";

describe("supplier invoice aging CSV", () => {
  it("includes the as-of date, aging buckets, and exact total while neutralizing formulas", () => {
    const csv = buildSupplierInvoiceAgingCsv([{
      supplierId: "supplier-1",
      supplierName: '=ACME, "Retail"',
      undatedCount: 1,
      undatedBalance: "4.40",
      currentCount: 1,
      currentBalance: "10.10",
      overdue1To30Count: 2,
      overdue1To30Balance: "20.20",
      overdue31To60Count: 0,
      overdue31To60Balance: "0",
      overdue61PlusCount: 1,
      overdue61PlusBalance: "30.30",
    }], "Accra Central", "2026-11-05", "GHS");

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Supplier","Store","As of"');
    expect(csv).toContain("\"'=ACME, \"\"Retail\"\"\"");
    expect(csv).toContain('"2026-11-05"');
    expect(csv).toContain('"4.40","1","10.10"');
    expect(csv).toContain('"65.00"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("returns the header and a zero total row when there are no outstanding invoices", () => {
    const csv = buildSupplierInvoiceAgingCsv([], "Accra Central", "2026-11-05", "GHS");

    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain('"Total outstanding balance"');
    expect(csv).toContain('"Total","Accra Central","2026-11-05","0","0.00"');
  });

  it("adds invoice counts and decimal bucket balances exactly", () => {
    const totals = summarizeSupplierInvoiceAging([
      {
        supplierId: "supplier-1",
        supplierName: "Supplier One",
        undatedCount: 0,
        undatedBalance: "0.10",
        currentCount: 1,
        currentBalance: "10.10",
        overdue1To30Count: 0,
        overdue1To30Balance: "0.00",
        overdue31To60Count: 1,
        overdue31To60Balance: "20.20",
        overdue61PlusCount: 0,
        overdue61PlusBalance: "0.00",
      },
      {
        supplierId: "supplier-2",
        supplierName: "Supplier Two",
        undatedCount: 1,
        undatedBalance: "0.20",
        currentCount: 0,
        currentBalance: "0.00",
        overdue1To30Count: 1,
        overdue1To30Balance: "30.30",
        overdue31To60Count: 0,
        overdue31To60Balance: "0.00",
        overdue61PlusCount: 1,
        overdue61PlusBalance: "40.40",
      },
    ]);

    expect(totals).toEqual({
      undatedCount: 1,
      undatedBalance: "0.30",
      currentCount: 1,
      currentBalance: "10.10",
      overdue1To30Count: 1,
      overdue1To30Balance: "30.30",
      overdue31To60Count: 1,
      overdue31To60Balance: "20.20",
      overdue61PlusCount: 1,
      overdue61PlusBalance: "40.40",
    });
  });

  it("exports invoice-level balances with formula-safe invoice and supplier identifiers", () => {
    const csv = buildSupplierInvoiceAgingDetailsCsv([{
      supplierName: "Supplier One",
      purchaseOrderNumber: 14,
      invoiceNumber: "=INV-15",
      invoiceDate: "2026-10-01",
      dueDate: "2026-10-10",
      daysOverdue: 26,
      invoiceAmount: "100.00",
      payments: "35.00",
      credits: "5.00",
      balance: "60.00",
    }], "Accra Central", "2026-11-05", "GHS");

    expect(csv).toContain('"Purchase order","Invoice number","Invoice date","Due date","Days overdue"');
    expect(csv).toContain('"14","\'=INV-15","2026-10-01","2026-10-10","26"');
    expect(csv).toContain('"100.00","35.00","5.00","60.00"');
  });

  it("exports undated invoices without implying they are overdue", () => {
    const csv = buildSupplierInvoiceAgingDetailsCsv([{
      supplierName: "Supplier Two",
      purchaseOrderNumber: 15,
      invoiceNumber: "INV-16",
      invoiceDate: "2026-10-01",
      dueDate: null,
      daysOverdue: null,
      invoiceAmount: "40.00",
      payments: "0.00",
      credits: "0.00",
      balance: "40.00",
    }], "Accra Central", "2026-11-05", "GHS");

    expect(csv).toContain('"15","INV-16","2026-10-01","","","40.00"');
    expect(csv).toContain('"Total","Accra Central","","1 invoices","","","","40.00","0.00","0.00","40.00"');
  });

  it("adds invoice details in exact cents and includes a zero total for empty exports", () => {
    const emptyCsv = buildSupplierInvoiceAgingDetailsCsv([], "Accra Central", "2026-11-05", "GHS");
    const combinedCsv = buildSupplierInvoiceAgingDetailsCsv([
      {
        supplierName: "Supplier One",
        purchaseOrderNumber: 14,
        invoiceNumber: "INV-14",
        invoiceDate: "2026-10-01",
        dueDate: "2026-10-10",
        daysOverdue: 26,
        invoiceAmount: "0.10",
        payments: "0.03",
        credits: "0.02",
        balance: "0.05",
      },
      {
        supplierName: "Supplier Two",
        purchaseOrderNumber: 15,
        invoiceNumber: "INV-15",
        invoiceDate: "2026-10-02",
        dueDate: null,
        daysOverdue: null,
        invoiceAmount: "0.20",
        payments: "0.04",
        credits: "0.06",
        balance: "0.10",
      },
    ], "Accra Central", "2026-11-05", "GHS");

    expect(emptyCsv).toContain('"Total","Accra Central","","0 invoices","","","","0.00","0.00","0.00","0.00"');
    expect(combinedCsv).toContain('"Total","Accra Central","","2 invoices","","","","0.30","0.07","0.08","0.15"');
  });
});
