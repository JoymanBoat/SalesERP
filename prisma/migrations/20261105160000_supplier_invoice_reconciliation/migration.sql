CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "createdById" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierInvoice_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "SupplierInvoicePayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "createdById" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoicePayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierInvoicePayment_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "SupplierCreditNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "createdById" TEXT,
    "creditNoteNumber" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCreditNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierCreditNote_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "SupplierInvoice_organizationId_supplierId_invoiceNumber_key"
ON "SupplierInvoice"("organizationId", "supplierId", "invoiceNumber");
CREATE UNIQUE INDEX "SupplierInvoice_organizationId_id_key"
ON "SupplierInvoice"("organizationId", "id");
CREATE UNIQUE INDEX "SupplierInvoice_organizationId_storeId_id_key"
ON "SupplierInvoice"("organizationId", "storeId", "id");
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_storeId_id_key"
ON "PurchaseOrder"("organizationId", "storeId", "id");
CREATE INDEX "SupplierInvoice_organizationId_storeId_invoiceDate_idx"
ON "SupplierInvoice"("organizationId", "storeId", "invoiceDate");
CREATE INDEX "SupplierInvoice_supplierId_dueDate_idx"
ON "SupplierInvoice"("supplierId", "dueDate");
CREATE INDEX "SupplierInvoice_purchaseOrderId_invoiceDate_idx"
ON "SupplierInvoice"("purchaseOrderId", "invoiceDate");

CREATE UNIQUE INDEX "SupplierInvoicePayment_idempotencyKey_key"
ON "SupplierInvoicePayment"("idempotencyKey");
CREATE INDEX "SupplierInvoicePayment_organizationId_storeId_paidAt_idx"
ON "SupplierInvoicePayment"("organizationId", "storeId", "paidAt");
CREATE INDEX "SupplierInvoicePayment_supplierInvoiceId_paidAt_idx"
ON "SupplierInvoicePayment"("supplierInvoiceId", "paidAt");

CREATE UNIQUE INDEX "SupplierCreditNote_idempotencyKey_key"
ON "SupplierCreditNote"("idempotencyKey");
CREATE UNIQUE INDEX "SupplierCreditNote_organizationId_supplierInvoiceId_creditNoteNumber_key"
ON "SupplierCreditNote"("organizationId", "supplierInvoiceId", "creditNoteNumber");
CREATE INDEX "SupplierCreditNote_organizationId_storeId_issuedAt_idx"
ON "SupplierCreditNote"("organizationId", "storeId", "issuedAt");
CREATE INDEX "SupplierCreditNote_supplierInvoiceId_issuedAt_idx"
ON "SupplierCreditNote"("supplierInvoiceId", "issuedAt");

ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_storeId_fkey"
FOREIGN KEY ("organizationId", "storeId") REFERENCES "Store"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey"
FOREIGN KEY ("organizationId", "supplierId") REFERENCES "Supplier"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_purchaseOrderId_fkey"
FOREIGN KEY ("organizationId", "storeId", "purchaseOrderId") REFERENCES "PurchaseOrder"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplierInvoicePayment" ADD CONSTRAINT "SupplierInvoicePayment_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoicePayment" ADD CONSTRAINT "SupplierInvoicePayment_storeId_fkey"
FOREIGN KEY ("organizationId", "storeId") REFERENCES "Store"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoicePayment" ADD CONSTRAINT "SupplierInvoicePayment_supplierInvoiceId_fkey"
FOREIGN KEY ("organizationId", "storeId", "supplierInvoiceId") REFERENCES "SupplierInvoice"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoicePayment" ADD CONSTRAINT "SupplierInvoicePayment_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplierCreditNote" ADD CONSTRAINT "SupplierCreditNote_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCreditNote" ADD CONSTRAINT "SupplierCreditNote_storeId_fkey"
FOREIGN KEY ("organizationId", "storeId") REFERENCES "Store"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierCreditNote" ADD CONSTRAINT "SupplierCreditNote_supplierInvoiceId_fkey"
FOREIGN KEY ("organizationId", "storeId", "supplierInvoiceId") REFERENCES "SupplierInvoice"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierCreditNote" ADD CONSTRAINT "SupplierCreditNote_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
