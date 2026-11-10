import { MembershipRole, NotificationType } from "@prisma/client";

const catalogManagementRoles = new Set<MembershipRole>([
  MembershipRole.OWNER,
  MembershipRole.MANAGER,
  MembershipRole.INVENTORY_MANAGER,
]);

export function canManageCatalog(role: MembershipRole) {
  return catalogManagementRoles.has(role);
}

const customerManagementRoles = new Set<MembershipRole>([
  MembershipRole.OWNER,
  MembershipRole.MANAGER,
  MembershipRole.CASHIER,
  MembershipRole.CUSTOMER_SUPPORT,
]);

export function canManageCustomers(role: MembershipRole) {
  return customerManagementRoles.has(role);
}

const supplierManagementRoles = new Set<MembershipRole>([
  MembershipRole.OWNER,
  MembershipRole.MANAGER,
  MembershipRole.INVENTORY_MANAGER,
]);

export function canManageSuppliers(role: MembershipRole) {
  return supplierManagementRoles.has(role);
}

const supplierInvoiceManagementRoles = new Set<MembershipRole>([
  MembershipRole.OWNER,
  MembershipRole.MANAGER,
  MembershipRole.ACCOUNTANT,
]);

export function canManageSupplierInvoices(role: MembershipRole) {
  return supplierInvoiceManagementRoles.has(role);
}

export function getVisibleNotificationTypes(role: MembershipRole) {
  const types = new Set<NotificationType>();
  if (canManageCatalog(role)) {
    types.add(NotificationType.LOW_STOCK);
    types.add(NotificationType.SUPPLIER_FOLLOW_UP);
  }
  if (canManageSupplierInvoices(role)) {
    types.add(NotificationType.SUPPLIER_INVOICE_OVERDUE);
    types.add(NotificationType.SUPPLIER_INVOICE_DUE_SOON);
  }
  if (role === MembershipRole.OWNER || role === MembershipRole.MANAGER) {
    types.add(NotificationType.DAILY_SALES_SUMMARY);
  }
  return [...types];
}

export function canManageOrganizationMembers(role: MembershipRole) {
  return role === MembershipRole.OWNER;
}

export function canManageStores(role: MembershipRole) {
  return role === MembershipRole.OWNER;
}

const registerOperationRoles = new Set<MembershipRole>([
  MembershipRole.OWNER,
  MembershipRole.MANAGER,
  MembershipRole.CASHIER,
]);

export function canOperateRegister(role: MembershipRole) {
  return registerOperationRoles.has(role);
}

const pricingManagementRoles = new Set<MembershipRole>([
  MembershipRole.OWNER,
  MembershipRole.MANAGER,
]);

export function canManagePricing(role: MembershipRole) {
  return pricingManagementRoles.has(role);
}
