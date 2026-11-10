import { describe, expect, it } from "vitest";
import { MembershipRole, Prisma } from "@prisma/client";

import { buildProductWhere, CatalogCsvError, parseCatalogCsv, parseProductImportCsv } from "./catalog";
import { formatGhanaCedis } from "./currency";
import { canManageCatalog, canManageCustomers, canManageSuppliers, canOperateRegister } from "./permissions";
import { buildSalesAccountingRows, buildTaxSnapshotRows, calculateCustomerRetentionMetrics, parseReportPeriod, toCsvCell } from "./reporting";
import { getPageCount, parsePage } from "./pagination";
import { customerInputSchema, customerStatusSchema, customerUpdateSchema, damagedStockSchema, inventoryAdjustmentSchema, inventoryCountSchema, productInputSchema, productStatusSchema, productUpdateSchema, productVariantInputSchema, productVariantUpdateSchema, purchaseOrderCancelSchema, purchaseOrderInputSchema, purchaseOrderReceiveSchema, registerShiftCloseSchema, registerShiftOpenSchema, registrationSchema, slugify, stockTransferSchema, supplierFollowUpSchema, supplierInputSchema, supplierReturnSchema, supplierStatusSchema, supplierUpdateSchema } from "./validation";

describe("formatGhanaCedis", () => {
  it("formats Ghana cedis with two decimal places", () => {
    expect(formatGhanaCedis("1234.5")).toContain("1,234.50");
  });

  it("rejects invalid monetary values", () => {
    expect(() => formatGhanaCedis("not-money")).toThrow(TypeError);
  });
});

describe("report period selection", () => {
  it("accepts supported periods and defaults invalid values to 30 days", () => {
    expect(parseReportPeriod("7")).toBe(7);
    expect(parseReportPeriod("30")).toBe(30);
    expect(parseReportPeriod("90")).toBe(90);
    expect(parseReportPeriod("365")).toBe(30);
    expect(parseReportPeriod(undefined)).toBe(30);
  });

  it("quotes CSV values and neutralizes spreadsheet formulas", () => {
    expect(toCsvCell('Ama "Retail"')).toBe('"Ama ""Retail"""');
    expect(toCsvCell("=HYPERLINK(\"https://example.com\")")).toBe('"\'=HYPERLINK(""https://example.com"")"');
    expect(toCsvCell("-20.00")).toBe('"-20.00"');
    expect(toCsvCell("-1+2")).toBe('"\'-1+2"');
    expect(toCsvCell("-001")).toBe('"\'-001"');
  });

  it("builds signed sales and refund rows with the cash and gift card split", () => {
    const rows = buildSalesAccountingRows(
      [{
        date: new Date("2026-11-05T10:00:00.000Z"),
        number: 42,
        subtotal: new Prisma.Decimal("100.00"),
        discount: new Prisma.Decimal("5.00"),
        tax: new Prisma.Decimal("9.50"),
        total: new Prisma.Decimal("104.50"),
        cash: new Prisma.Decimal("54.50"),
        giftCard: new Prisma.Decimal("50.00"),
      }],
      [{
        date: new Date("2026-11-05T11:00:00.000Z"),
        number: 42,
        amount: new Prisma.Decimal("20.00"),
        cashRefundAmount: new Prisma.Decimal("10.00"),
      }],
      "GHS",
    );

    expect(rows[1]).toEqual(["2026-11-05T10:00:00.000Z", "SALE", 42, "100.00", "5.00", "9.50", "104.50", "", "54.50", "50.00", "GHS"]);
    expect(rows[2]).toEqual(["2026-11-05T11:00:00.000Z", "REFUND", 42, "", "", "", "", "-20.00", "-10.00", "-10.00", "GHS"]);
  });

  it("exports saved tax snapshots without inventing refund tax allocations", () => {
    const rows = buildTaxSnapshotRows(
      [{
        date: new Date("2026-11-05T10:00:00.000Z"),
        number: 42,
        taxRate: new Prisma.Decimal("10.00"),
        subtotal: new Prisma.Decimal("100.00"),
        discount: new Prisma.Decimal("5.00"),
        tax: new Prisma.Decimal("9.50"),
        total: new Prisma.Decimal("104.50"),
      }],
      [{
        date: new Date("2026-11-05T11:00:00.000Z"),
        number: 42,
        amount: new Prisma.Decimal("20.00"),
      }],
      "GHS",
    );

    expect(rows[1]).toEqual(["2026-11-05T10:00:00.000Z", "SALE", 42, "10.00", "95.00", "9.50", "104.50", "", "GHS", "Recorded order tax snapshot", "", "", "", "", "", "", "", ""]);
    expect(rows[0].slice(10)).toEqual(["VAT rate (%)", "VAT", "NHIL rate (%)", "NHIL", "GETFund rate (%)", "GETFund", "Component snapshot", "Item tax treatments"]);
    expect(rows[2][1]).toBe("REFUND");
    expect(rows[2][7]).toBe("-20.00");
    expect(rows[2][9]).toContain("not stored");
  });

  it("exports component snapshots, item treatments, and flags legacy combined orders", () => {
    const base = {
      date: new Date("2026-11-05T10:00:00.000Z"),
      taxRate: new Prisma.Decimal("20.00"),
      subtotal: new Prisma.Decimal("100.00"),
      discount: new Prisma.Decimal("0"),
      tax: new Prisma.Decimal("20.00"),
      total: new Prisma.Decimal("120.00"),
    };
    const rows = buildTaxSnapshotRows([
      {
        ...base,
        number: 1,
        components: {
          recorded: true,
          vatRate: new Prisma.Decimal("15"), vat: new Prisma.Decimal("15"),
          nhilRate: new Prisma.Decimal("2.5"), nhil: new Prisma.Decimal("2.5"),
          getfundRate: new Prisma.Decimal("2.5"), getfund: new Prisma.Decimal("2.5"),
          treatments: ["STANDARD", "EXEMPT", "STANDARD"],
        },
      },
      {
        ...base,
        number: 2,
        date: new Date("2026-11-05T11:00:00.000Z"),
        components: {
          recorded: false,
          vatRate: new Prisma.Decimal("0"), vat: new Prisma.Decimal("0"),
          nhilRate: new Prisma.Decimal("0"), nhil: new Prisma.Decimal("0"),
          getfundRate: new Prisma.Decimal("0"), getfund: new Prisma.Decimal("0"),
          treatments: ["STANDARD"],
        },
      },
    ], [], "GHS");

    expect(rows[1].slice(10)).toEqual(["15.00", "15.00", "2.50", "2.50", "2.50", "2.50", "RECORDED", "EXEMPT:1;STANDARD:2"]);
    expect(rows[2].slice(10)).toEqual(["", "", "", "", "", "", "LEGACY_COMBINED_ONLY", ""]);
  });

  it("calculates store-period active and repeat customer metrics", () => {
    const metrics = calculateCustomerRetentionMetrics([
      { orderCount: 1n, netSpend: new Prisma.Decimal("20.00") },
      { orderCount: 3n, netSpend: new Prisma.Decimal("80.50") },
    ]);

    expect(metrics.activeCustomerCount).toBe(2);
    expect(metrics.repeatCustomerCount).toBe(1);
    expect(metrics.repeatCustomerRate).toBe(50);
    expect(metrics.repeatCustomerNetSales.toFixed(2)).toBe("80.50");
    expect(calculateCustomerRetentionMetrics([]).repeatCustomerRate).toBe(0);
  });
});

describe("customer history pagination", () => {
  it("defaults invalid page parameters and accepts positive integer pages", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage("3")).toBe(3);
  });

  it("calculates page counts including empty histories", () => {
    expect(getPageCount(0, 20)).toBe(1);
    expect(getPageCount(20, 20)).toBe(1);
    expect(getPageCount(21, 20)).toBe(2);
    expect(() => getPageCount(-1, 20)).toThrow(RangeError);
  });
});

describe("business onboarding validation", () => {
  it("normalizes the sign-in email and requires a strong password", () => {
    const result = registrationSchema.safeParse({
      ownerName: "Ama Mensah",
      businessName: "Accra Home",
      storeName: "Osu",
      email: "AMA@EXAMPLE.COM ",
      password: "a-secure-password",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("ama@example.com");
  });

  it("rejects passwords shorter than twelve characters", () => {
    expect(registrationSchema.safeParse({
      ownerName: "Ama Mensah",
      businessName: "Accra Home",
      storeName: "Osu",
      email: "ama@example.com",
      password: "short",
    }).success).toBe(false);
  });

  it("creates an ASCII business slug from local names", () => {
    expect(slugify("Accra & Co.")).toBe("accra-co");
  });
});

describe("product and inventory validation", () => {
  it("parses quoted CSV values, escaped quotes, and embedded newlines", () => {
    expect(parseCatalogCsv('Name,Description\r\n"Runner, woven","Ama ""Kente""\nCollection"\r\n')).toEqual([
      ["Name", "Description"],
      ["Runner, woven", 'Ama "Kente"\nCollection'],
    ]);
  });

  it("rejects malformed or incomplete CSV quoting", () => {
    expect(() => parseCatalogCsv('Name,SKU\n"Runner,ABC')).toThrow(CatalogCsvError);
    expect(() => parseCatalogCsv('Name,SKU\nRunner"One,ABC')).toThrow(CatalogCsvError);
    expect(() => parseCatalogCsv('Name,SKU\n"Runner"tail,ABC')).toThrow(CatalogCsvError);
  });

  it("validates import rows and rejects duplicate SKUs before writing", () => {
    const csv = "\uFEFFProduct name,SKU,Barcode,Category,Unit price,Cost price,Opening stock,Reorder point\r\nKente Runner,KNT-1,,Textiles,10.50,5,4,2\r\n";
    expect(parseProductImportCsv(csv)).toEqual([
      {
        name: "Kente Runner",
        sku: "KNT-1",
        barcode: "",
        category: "Textiles",
        unitPrice: "10.50",
        costPrice: "5",
        initialStock: 4,
        reorderPoint: 2,
        taxTreatment: "STANDARD",
      },
    ]);
    expect(() => parseProductImportCsv(`${csv}Kente Runner Two,KNT-1,,Textiles,10,5,0,2\r\n`)).toThrow(/appears more than once/);
    expect(() => parseProductImportCsv(csv.replace(",10.50,5,", ",0,5,"))).toThrow(/Row 2/);
  });

  it("enforces CSV import header and batch-size limits", () => {
    const header = "Product name,SKU,Unit price,Opening stock,Reorder point";
    const row = (index: number) => `Kente Runner ${index},KNT-${index},10.50,0,0`;

    expect(() => parseProductImportCsv(`${header},SKU\n${row(1)},DUPLICATE`)).toThrow(/duplicate column names/);
    expect(() => parseProductImportCsv(`${header},Unknown\n${row(1)},value`)).toThrow(/not supported/);
    expect(parseProductImportCsv(`${header}\n${Array.from({ length: 50 }, (_, index) => row(index + 1)).join("\n")}`)).toHaveLength(50);
    expect(() => parseProductImportCsv(`${header}\n${Array.from({ length: 51 }, (_, index) => row(index + 1)).join("\n")}`)).toThrow(/up to 50 products/);
  });

  it("builds catalog filters for search text and archived status", () => {
    expect(buildProductWhere("Kente", false)).toEqual({
      archivedAt: null,
      OR: [
        { name: { contains: "Kente", mode: "insensitive" } },
        { category: { name: { contains: "Kente", mode: "insensitive" } } },
        {
          variants: {
            some: {
              OR: [
                { sku: { contains: "Kente", mode: "insensitive" } },
                { barcode: { contains: "Kente", mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
    expect(buildProductWhere("", true)).toEqual({ archivedAt: { not: null } });
  });

  const validProduct = {
    name: "Kente Table Runner",
    sku: "KNT-RUN-001",
    unitPrice: "125.50",
    costPrice: "72",
    initialStock: "12",
    reorderPoint: "3",
  };

  it("accepts a valid Ghana-currency product with initial stock", () => {
    expect(productInputSchema.safeParse(validProduct).success).toBe(true);
  });

  it("validates variant creation stock and variant edits independently", () => {
    const productId = "clh1p2s3t0000qwertyuiopas";
    const variant = {
      productId,
      name: "Large / Blue",
      sku: "KNT-BL-L",
      unitPrice: "130.00",
      initialStock: "4",
      reorderPoint: "1",
    };
    expect(productVariantInputSchema.safeParse(variant).success).toBe(true);
    expect(productVariantInputSchema.safeParse({ ...variant, sku: "invalid sku" }).success).toBe(false);
    expect(productVariantUpdateSchema.safeParse({
      productId,
      variantId: "clh1p2s3t0000qwertyuiopas",
      name: "Large / Blue",
      sku: "KNT-BL-L",
      unitPrice: "130.00",
    }).success).toBe(true);
  });

  it("rejects malformed SKUs and prices with more than two decimals", () => {
    expect(productInputSchema.safeParse({ ...validProduct, sku: "KENTE RUNNER" }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...validProduct, unitPrice: "12.345" }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...validProduct, unitPrice: "0" }).success).toBe(false);
  });

  it("validates product edits without accepting stock changes and validates archive status", () => {
    const productId = "clh1p2s3t0000qwertyuiopas";
    expect(productUpdateSchema.safeParse({
      productId,
      name: "Kente Table Runner",
      sku: "KNT-RUN-001",
      unitPrice: "125.50",
    }).success).toBe(true);
    const edit = productUpdateSchema.safeParse({
      productId,
      name: "Kente Table Runner",
      sku: "KNT-RUN-001",
      unitPrice: "125.50",
      initialStock: "99",
      reorderPoint: "0",
    });
    expect(edit.success).toBe(true);
    if (edit.success) {
      expect("initialStock" in edit.data).toBe(false);
      expect("reorderPoint" in edit.data).toBe(false);
    }
    expect(productStatusSchema.safeParse({ productId, archived: "true" }).success).toBe(true);
    expect(productStatusSchema.safeParse({ productId, archived: "archive" }).success).toBe(false);
  });

  it("rejects zero, fractional, and excessive stock adjustments", () => {
    const variantId = "clh1p2s3t0000qwertyuiopas";
    expect(inventoryAdjustmentSchema.safeParse({ variantId, quantityDelta: "0", reason: "Count correction" }).success).toBe(false);
    expect(inventoryAdjustmentSchema.safeParse({ variantId, quantityDelta: "1.5", reason: "Count correction" }).success).toBe(false);
    expect(inventoryAdjustmentSchema.safeParse({ variantId, quantityDelta: "-4", reason: "Count correction" }).success).toBe(true);
  });

  it("validates positive bounded damaged-stock quantities and audit reasons", () => {
    const damaged = {
      variantId: "clh1p2s3t0000qwertyuiopas",
      quantity: "2",
      reason: "Broken during handling",
    };
    expect(damagedStockSchema.safeParse(damaged).success).toBe(true);
    expect(damagedStockSchema.safeParse({ ...damaged, quantity: "0" }).success).toBe(false);
    expect(damagedStockSchema.safeParse({ ...damaged, quantity: "1.5" }).success).toBe(false);
    expect(damagedStockSchema.safeParse({ ...damaged, reason: "x" }).success).toBe(false);
  });

  it("validates physical stock counts and audit notes", () => {
    const count = {
      variantId: "clh1p2s3t0000qwertyuiopas",
      expectedQuantity: "12",
      countedQuantity: "10",
      reason: "Weekly shelf count",
    };
    expect(inventoryCountSchema.safeParse(count).success).toBe(true);
    expect(inventoryCountSchema.safeParse({ ...count, countedQuantity: "-1" }).success).toBe(false);
    expect(inventoryCountSchema.safeParse({ ...count, countedQuantity: "10.5" }).success).toBe(false);
    expect(inventoryCountSchema.safeParse({ ...count, reason: "x" }).success).toBe(false);
  });

  it("validates positive, bounded inter-store transfer quantities", () => {
    const transfer = {
      variantId: "clh1p2s3t0000qwertyuiopas",
      toStoreId: "clh1p2s3t0000qwertyuiopas",
      quantity: "3",
      reason: "Branch replenishment",
    };
    expect(stockTransferSchema.safeParse(transfer).success).toBe(true);
    expect(stockTransferSchema.safeParse({ ...transfer, quantity: "0" }).success).toBe(false);
    expect(stockTransferSchema.safeParse({ ...transfer, quantity: "1.5" }).success).toBe(false);
    expect(stockTransferSchema.safeParse({ ...transfer, reason: "x" }).success).toBe(false);
  });
});

describe("customer validation", () => {
  it("normalizes email and accepts optional contact details", () => {
    const result = customerInputSchema.safeParse({
      firstName: "  Ama  ",
      lastName: "Mensah",
      email: "AMA@EXAMPLE.COM ",
      phone: "+233 24 123 4567",
      notes: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe("Ama");
      expect(result.data.email).toBe("ama@example.com");
    }
  });

  it("rejects malformed email and phone values", () => {
    expect(customerInputSchema.safeParse({ firstName: "Ama", email: "invalid" }).success).toBe(false);
    expect(customerInputSchema.safeParse({ firstName: "Ama", phone: "call me" }).success).toBe(false);
  });

  it("validates customer updates and explicit active status", () => {
    const customerId = "clh1p2s3t0000qwertyuiopas";
    expect(customerUpdateSchema.safeParse({ customerId, firstName: "Ama" }).success).toBe(true);
    expect(customerStatusSchema.safeParse({ customerId, active: "false" }).success).toBe(true);
    expect(customerStatusSchema.safeParse({ customerId, active: "yes" }).success).toBe(false);
  });
});

describe("catalog access permissions", () => {
  it("allows owners, managers, and inventory managers to change products and stock", () => {
    expect(canManageCatalog(MembershipRole.OWNER)).toBe(true);
    expect(canManageCatalog(MembershipRole.MANAGER)).toBe(true);
    expect(canManageCatalog(MembershipRole.INVENTORY_MANAGER)).toBe(true);
  });

  it("keeps cashier and reporting/support roles read-only", () => {
    expect(canManageCatalog(MembershipRole.CASHIER)).toBe(false);
    expect(canManageCatalog(MembershipRole.ACCOUNTANT)).toBe(false);
    expect(canManageCatalog(MembershipRole.CUSTOMER_SUPPORT)).toBe(false);
  });
});

describe("customer access permissions", () => {
  it("allows customer-facing staff to manage records without granting access to unrelated roles", () => {
    expect(canManageCustomers(MembershipRole.OWNER)).toBe(true);
    expect(canManageCustomers(MembershipRole.MANAGER)).toBe(true);
    expect(canManageCustomers(MembershipRole.CASHIER)).toBe(true);
    expect(canManageCustomers(MembershipRole.CUSTOMER_SUPPORT)).toBe(true);
    expect(canManageCustomers(MembershipRole.INVENTORY_MANAGER)).toBe(false);
    expect(canManageCustomers(MembershipRole.ACCOUNTANT)).toBe(false);
  });
});

describe("supplier validation and permissions", () => {
  it("validates supplier follow-up contact details and optional dates", () => {
    const followUp = {
      purchaseOrderId: "clh1p2s3t0000qwertyuiopas",
      method: "PHONE",
      summary: "Supplier confirmed dispatch tomorrow",
      followUpAt: "2026-11-06",
    };
    expect(supplierFollowUpSchema.safeParse(followUp).success).toBe(true);
    expect(supplierFollowUpSchema.safeParse({ ...followUp, method: "SMS" }).success).toBe(false);
    expect(supplierFollowUpSchema.safeParse({ ...followUp, summary: "x" }).success).toBe(false);
    expect(supplierFollowUpSchema.safeParse({ ...followUp, followUpAt: "2026-02-30" }).success).toBe(false);
    expect(supplierFollowUpSchema.safeParse({ ...followUp, followUpAt: "" }).success).toBe(true);
  });

  it("normalizes supplier email and validates optional contact fields", () => {
    const result = supplierInputSchema.safeParse({
      businessName: "  Accra Textiles  ",
      contactName: "Ama",
      email: "SALES@EXAMPLE.COM ",
      phone: "+233 24 123 4567",
      address: "Osu, Accra",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.businessName).toBe("Accra Textiles");
      expect(result.data.email).toBe("sales@example.com");
    }
    expect(supplierInputSchema.safeParse({ businessName: "Supplier", email: "bad" }).success).toBe(false);
  });

  it("validates supplier updates and explicit active status", () => {
    const supplierId = "clh1p2s3t0000qwertyuiopas";
    expect(supplierUpdateSchema.safeParse({ supplierId, businessName: "Accra Textiles" }).success).toBe(true);
    expect(supplierStatusSchema.safeParse({ supplierId, active: "false" }).success).toBe(true);
    expect(supplierStatusSchema.safeParse({ supplierId, active: "inactive" }).success).toBe(false);
  });

  it("allows owner, manager, and inventory manager supplier access only", () => {
    expect(canManageSuppliers(MembershipRole.OWNER)).toBe(true);
    expect(canManageSuppliers(MembershipRole.MANAGER)).toBe(true);
    expect(canManageSuppliers(MembershipRole.INVENTORY_MANAGER)).toBe(true);
    expect(canManageSuppliers(MembershipRole.CASHIER)).toBe(false);
    expect(canManageSuppliers(MembershipRole.ACCOUNTANT)).toBe(false);
    expect(canManageSuppliers(MembershipRole.CUSTOMER_SUPPORT)).toBe(false);
  });
});

describe("register shift validation and access", () => {
  const shiftId = "clh1p2s3t0003qwertyuiopas";

  it("accepts non-negative two-decimal opening and closing cash amounts", () => {
    expect(registerShiftOpenSchema.safeParse({ openingCash: "100.25", note: "Till A" }).success).toBe(true);
    expect(registerShiftOpenSchema.safeParse({ openingCash: "0" }).success).toBe(true);
    expect(registerShiftOpenSchema.safeParse({ openingCash: "-1" }).success).toBe(false);
    expect(registerShiftOpenSchema.safeParse({ openingCash: "1.999" }).success).toBe(false);
    expect(registerShiftCloseSchema.safeParse({ shiftId, closingCash: "98.75" }).success).toBe(true);
    expect(registerShiftCloseSchema.safeParse({ shiftId, closingCash: "NaN" }).success).toBe(false);
  });

  it("allows owner, manager, and cashier register operations only", () => {
    expect(canOperateRegister(MembershipRole.OWNER)).toBe(true);
    expect(canOperateRegister(MembershipRole.MANAGER)).toBe(true);
    expect(canOperateRegister(MembershipRole.CASHIER)).toBe(true);
    expect(canOperateRegister(MembershipRole.INVENTORY_MANAGER)).toBe(false);
    expect(canOperateRegister(MembershipRole.ACCOUNTANT)).toBe(false);
    expect(canOperateRegister(MembershipRole.CUSTOMER_SUPPORT)).toBe(false);
  });
});

describe("purchase order validation", () => {
  const supplierId = "clh1p2s3t0000qwertyuiopas";
  const variantId = "clh1p2s3t0001qwertyuiopas";
  const itemId = "clh1p2s3t0002qwertyuiopas";
  const purchaseOrderId = "clh1p2s3t0003qwertyuiopas";

  it("accepts a purchase order with bounded, unique product lines", () => {
    expect(purchaseOrderInputSchema.safeParse({
      supplierId,
      expectedAt: "2026-12-01",
      notes: "Deliver to main store",
      lines: [{ variantId, quantity: 3, unitCost: "12.50" }],
    }).success).toBe(true);
    expect(purchaseOrderInputSchema.safeParse({
      supplierId,
      lines: [
        { variantId, quantity: 3, unitCost: "12.50" },
        { variantId, quantity: 1, unitCost: "12.50" },
      ],
    }).success).toBe(false);
    expect(purchaseOrderInputSchema.safeParse({
      supplierId,
      expectedAt: "2026-02-30",
      lines: [{ variantId, quantity: 3, unitCost: "12.50" }],
    }).success).toBe(false);
  });

  it("requires a positive outstanding receipt quantity and unique order lines", () => {
    expect(purchaseOrderReceiveSchema.safeParse({
      purchaseOrderId,
      lines: [{ itemId, quantity: 2 }],
    }).success).toBe(true);
    expect(purchaseOrderReceiveSchema.safeParse({
      purchaseOrderId,
      lines: [{ itemId, quantity: 0 }],
    }).success).toBe(false);
    expect(purchaseOrderReceiveSchema.safeParse({
      purchaseOrderId,
      lines: [{ itemId, quantity: 1 }, { itemId, quantity: 1 }],
    }).success).toBe(false);
  });

  it("requires a valid purchase order id to cancel", () => {
    expect(purchaseOrderCancelSchema.safeParse({ purchaseOrderId }).success).toBe(true);
    expect(purchaseOrderCancelSchema.safeParse({ purchaseOrderId: "invalid" }).success).toBe(false);
  });

  it("validates supplier return quantities and reasons", () => {
    const supplierReturn = { purchaseOrderId, itemId, quantity: "1", reason: "Damaged on delivery" };
    expect(supplierReturnSchema.safeParse(supplierReturn).success).toBe(true);
    expect(supplierReturnSchema.safeParse({ ...supplierReturn, quantity: "0" }).success).toBe(false);
    expect(supplierReturnSchema.safeParse({ ...supplierReturn, quantity: "1.5" }).success).toBe(false);
    expect(supplierReturnSchema.safeParse({ ...supplierReturn, reason: "x" }).success).toBe(false);
  });
});
