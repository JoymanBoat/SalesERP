CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Category_name_trgm_idx" ON "Category" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "ProductVariant_name_trgm_idx" ON "ProductVariant" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "ProductVariant_sku_trgm_idx" ON "ProductVariant" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX "ProductVariant_barcode_trgm_idx" ON "ProductVariant" USING GIN ("barcode" gin_trgm_ops);

CREATE INDEX "Customer_firstName_trgm_idx" ON "Customer" USING GIN ("firstName" gin_trgm_ops);
CREATE INDEX "Customer_lastName_trgm_idx" ON "Customer" USING GIN ("lastName" gin_trgm_ops);
CREATE INDEX "Customer_email_trgm_idx" ON "Customer" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "Customer_phone_trgm_idx" ON "Customer" USING GIN ("phone" gin_trgm_ops);

CREATE INDEX "Supplier_businessName_trgm_idx" ON "Supplier" USING GIN ("businessName" gin_trgm_ops);
CREATE INDEX "Supplier_contactName_trgm_idx" ON "Supplier" USING GIN ("contactName" gin_trgm_ops);
CREATE INDEX "Supplier_email_trgm_idx" ON "Supplier" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "Supplier_phone_trgm_idx" ON "Supplier" USING GIN ("phone" gin_trgm_ops);
CREATE INDEX "Supplier_address_trgm_idx" ON "Supplier" USING GIN ("address" gin_trgm_ops);

CREATE INDEX "InventoryMovement_reason_trgm_idx" ON "InventoryMovement" USING GIN ("reason" gin_trgm_ops);
CREATE INDEX "PurchaseOrder_notes_trgm_idx" ON "PurchaseOrder" USING GIN ("notes" gin_trgm_ops);
CREATE INDEX "PurchaseOrderItem_productName_trgm_idx" ON "PurchaseOrderItem" USING GIN ("productName" gin_trgm_ops);
CREATE INDEX "PurchaseOrderItem_sku_trgm_idx" ON "PurchaseOrderItem" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX "SupplierInvoice_invoiceNumber_trgm_idx" ON "SupplierInvoice" USING GIN ("invoiceNumber" gin_trgm_ops);

CREATE INDEX "OrderItem_productName_trgm_idx" ON "OrderItem" USING GIN ("productName" gin_trgm_ops);
CREATE INDEX "OrderItem_sku_trgm_idx" ON "OrderItem" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX "GiftCard_codeLastFour_trgm_idx" ON "GiftCard" USING GIN ("codeLastFour" gin_trgm_ops);

CREATE INDEX "AuditLog_action_trgm_idx" ON "AuditLog" USING GIN ("action" gin_trgm_ops);
CREATE INDEX "AuditLog_entityType_trgm_idx" ON "AuditLog" USING GIN ("entityType" gin_trgm_ops);
CREATE INDEX "AuditLog_entityId_trgm_idx" ON "AuditLog" USING GIN ("entityId" gin_trgm_ops);
CREATE INDEX "User_name_trgm_idx" ON "User" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "User_email_trgm_idx" ON "User" USING GIN ("email" gin_trgm_ops);
