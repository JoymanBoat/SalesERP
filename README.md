# Keta Retail

Keta Retail is a Ghana-focused retail operations and point-of-sale platform. The implementation is being developed in phases; this repository currently provides organization onboarding, credential authentication, a tenant-scoped live dashboard, product catalog creation/search, per-store opening stock, stock adjustments, and inventory history.

For day-to-day setup and operating instructions, see the [user manual](USER_MANUAL.md).

## Stack

- Next.js App Router, React, and TypeScript
- PostgreSQL with Prisma
- Auth.js credentials sessions and bcrypt password hashes
- Zod request validation
- Tailwind CSS v4 with a small custom design system

## Requirements

- Node.js 20.9 or newer
- PostgreSQL 14 or newer

## Local setup

1. Copy `.env.example` to `.env` and configure `DATABASE_URL` for your PostgreSQL database.
2. Replace `AUTH_SECRET` with a random secret of at least 32 characters.
3. Install dependencies with `npm install` (in PowerShell, use `npm.cmd install`).
4. Generate the Prisma client and apply migrations with `npm run db:generate` and `npm run db:migrate` (in PowerShell, use `npm.cmd run db:generate` and `npm.cmd run db:migrate`).
5. Start the development server with `npm run dev` (in PowerShell, use `npm.cmd run dev`).

PowerShell can resolve `npm` to `npm.ps1`, which may be blocked by the local execution policy. Use the Windows command shim `npm.cmd` instead; this does not require changing PowerShell's execution policy.

For isolated testing on a phone, set `AUTH_URL` in `.env` to the laptop's current Wi-Fi address and port, for example `http://192.168.0.100:3000`, then restart the development server. Open that same address on the phone and computer. Next.js allows the configured `AUTH_URL` hostname for development assets; update it and restart if the laptop's address changes. Local HTTP is unencrypted: use only test data and test passwords on a trusted network, never real business credentials. Use HTTPS for real data.

The initial owner registration at `/register` atomically creates a Ghana-based organization, its owner membership, and its first store. The business currency is GHS and the default timezone is `Africa/Accra`.

### Platform administrator (early access)

The platform administrator is a separate account from business owners. After applying migrations, a trusted deployment administrator can create the first account once on Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\create-platform-admin.ps1
```

The command prompts for a name, email and password without displaying the password. It refuses to run if a platform administrator already exists and does not promote existing business accounts. Restrict command and database access to trusted administrators. Sign in with the new account to view the business directory and a read-only overview of stores, products and recent sales; platform access is recorded in the platform audit log. Each list currently shows at most 100 records. Multi-factor authentication is not yet implemented; use this only in a protected test deployment.

Platform administrators can configure Starter, Growth and Pro on the Packages page. Default feature sets and limits are populated, but monthly and annual GHS prices are unset until configured; blank limits mean unlimited. Changes are recorded in the platform audit log and apply immediately to active paid subscriptions on that package. Existing businesses without an assigned subscription retain unrestricted legacy access.

From a business's subscription records, an administrator can start one 30-day trial or activate/renew a paid plan using an unused, non-voided payment recorded for that business. Payment records are manual confirmations of money received externally; the app does not collect or verify funds. References are case-insensitively unique per business, including voided entries. Activating a paid plan consumes that payment record so it cannot be reused or voided. Monthly and annual terms use calendar periods; renewals extend from the current expiry, while package access changes immediately. These actions are audited.

Paid subscriptions enforce configured features and capacity limits. Active store limits count active stores; staff limits count all organization memberships, including owners. Pending invitations do not reserve capacity; limits are checked again when invitations are accepted. Trials include all configured features and last 30 days. At expiry, business data remains available read-only; business mutations are blocked until a paid plan is renewed. Feature-disabled areas and exports are blocked, including direct server actions; the dashboard hides metrics for disabled features. Subscription payments remain manual and no payment-provider integration or automated billing is included.

Completed sale receipts can optionally be shared from the receipt page using the seller's SMS or WhatsApp app. The message includes a bearer link valid for 30 days; anyone holding it can view the receipt without signing in. The link uses `AUTH_URL`, which must be a publicly reachable HTTPS origin for real customers. Links are signed with `AUTH_SECRET`: keep it private and stable; rotating it invalidates existing links and sessions. Links cannot currently be revoked individually. No SMS or WhatsApp provider is integrated and the application cannot confirm message delivery.

Password recovery uses provider-neutral SMTP over TLS. Configure `SMTP_HOST`, `SMTP_PORT` (implicit TLS; normally `465`), `SMTP_FROM`, and optionally both `SMTP_USER` and `SMTP_PASSWORD` in the deployment environment. Do not commit credentials. Password-reset links expire after 30 minutes, can be used once, and revoke prior sessions. Requests use the same response whether or not an account exists. Delivery has not been verified until valid SMTP settings are supplied.

Owners can invite employees from `/team`; invitations are restricted to active stores and their POS registers and expire after 72 hours. Invitees create their account through the emailed one-time link, which verifies that they control the invited email address. SMTP must be configured for invitation delivery.

### Business notifications

The workspace provides in-app and email notifications for low stock (one reminder per item each week while it remains low), scheduled supplier follow-ups, outstanding supplier invoices due within seven days or overdue, and daily sales summaries. Alerts are scoped to active stores the recipient can access: inventory/purchasing managers receive stock and follow-up reminders, accountants receive invoice reminders, and owners/managers receive all applicable notices and sales summaries. Email uses the same provider-neutral implicit-TLS SMTP settings above; no SMS, WhatsApp, or hardware integrations are included.

Run the protected `POST /api/notifications/scheduled` endpoint once daily, preferably at `00:15 UTC`. The endpoint calculates each workspace's business date from its configured timezone, summarizes the previous completed business day, and generates the current day's operational reminders. It is safe to retry: notification events are deduplicated and unfinished email delivery is retried. Configure `NOTIFICATIONS_CRON_SECRET` with a random value of at least 32 characters and send it as a bearer token, for example:

```sh
curl -X POST https://your-saleserp-host.example/api/notifications/scheduled \
  -H "Authorization: Bearer $NOTIFICATIONS_CRON_SECRET"
```

Set the same secret in the application and external scheduler; do not put it in a URL or commit it. The application does not install or depend on a particular scheduling provider. SMTP delivery remains unverified until deployment settings are supplied.

### Local PostgreSQL on Windows

After installing PostgreSQL, configure the local `.env` connection. The project creates a dedicated app role and database, then verifies the connection. In PowerShell, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-local-postgres.ps1
```

Enter the installer-created `postgres` administrator password when prompted. The script reads the app password from `.env` without displaying it, sets it for the dedicated `saleserp_app` role, creates the `saleserp` database if needed, and checks that the app role can connect. It only overrides PowerShell's execution policy for that one process. Keep `.env` private; then run `npm run db:migrate`.

### Docker deployment

Docker Compose runs the production standalone Next.js image, PostgreSQL 17 with a persistent named volume, and a one-shot migration container before the app starts. The application connects as a non-superuser database role; the separate database administrator credential is only used to initialize PostgreSQL. Docker Engine and the Compose plugin must be installed.

1. Copy `.env.example` to `.env`. Generate separate random values for `AUTH_SECRET`, `POSTGRES_ADMIN_PASSWORD`, and `POSTGRES_APP_PASSWORD`; the database passwords must be hexadecimal so they can safely appear in the internal connection URL. For example, generate each with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Set `AUTH_URL` to the externally reachable HTTPS origin in production. Keep `.env` private.
3. Build and start with `docker compose up --build -d`.
4. Check readiness with `docker compose ps` or `curl.exe http://localhost:3000/api/health`. The health endpoint returns 503 when PostgreSQL is unavailable. To apply migrations without starting the web app, use `docker compose run --rm migrate`.

The database volume survives container replacement; it is not a backup. Create a timestamped, uniquely named custom-format dump and validate its archive with `pg_restore --list`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup-docker-postgres.ps1
```

Protect backups as sensitive business data and copy them off the host. To restore, pass a backup under `.\backups`; the helper validates the archive, prints the target, and requires the exact `RESTORE saleserp` confirmation. It stops the app before restoring and leaves it stopped if the restore fails:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\restore-docker-postgres.ps1 .\backups\saleserp-YYYYMMDD-HHMMSS.dump
docker compose up -d
```

The restore replaces objects contained in the archive in the `saleserp` database; it does not remove objects created after that backup. Test restores periodically in an isolated environment before relying on them.

## Current scope

The dashboard, catalog, inventory, customer, supplier, purchasing, POS, register-shift, and reports views read organization-scoped data from PostgreSQL; they do not display fabricated sample metrics. Purchasing shows the count of open orders past their expected delivery date in the organization timezone and supports an overdue-only status filter; received, cancelled, and undated orders are not marked overdue. Staff with purchasing access can record supplier contact attempts on overdue open orders or orders with a due follow-up, including contact method, summary, and an optional next follow-up date. Due follow-ups are counted and filterable per selected store, and the latest scheduled date is stored on the order for efficient reminders while each contact entry remains in the audit-linked history. Purchase orders can be printed as supplier-facing documents with ship-to store, item quantities, unit costs, subtotal, delivery date, and notes; the print view excludes internal receiving and invoice controls and is not a tax invoice. The dashboard highlights up to five lowest-stock tracked variants at or below reorder point for the selected store, including on-hand and reserved quantities, with a link to inventory. Inventory can be filtered by all stock, low stock, or out of stock while retaining search and pagination, and exported as a formula-safe CSV using the selected stock status and search. Inventory shows the quantity needed to bring available stock (after reservations) up to the configured reorder point; catalog/purchasing managers can use an item’s Order link to prefill a draft purchase order with that variant and quantity. Supplier and unit cost remain editable, and the threshold quantity is only a starting point, not a demand forecast or purchase recommendation. Catalog managers can update each tracked variant’s reorder point for the selected store from the inventory table; changes are validated, stale edits are rejected, and updates are audited. POS supports held carts that reserve tracked stock, split cash/gift-card checkout, configurable organization tax (default 0%), manager-only discounts, saved line-price/tax/discount snapshots, manager-authorized voids, refunds and item returns, optional return restocking, transaction search, and printable sale receipts. A keyboard-wedge barcode scanner can scan a variant barcode into the POS product search and press Enter to add a unique active match to the cart; no device-specific driver is required. Stock reservations are released atomically when a held cart is checked out or voided; the inventory view shows on-hand, reserved, and available quantities. Checkout updates tracked inventory and writes payment, movement, and audit records in one transaction. Owner, manager, and cashier roles can operate assigned POS registers; each station has its own shift and cash reconciliation. Expected drawer cash is opening float plus completed cash tender less cash refunds recorded on that shift; gift-card tender and gift-card refund value do not affect drawer reconciliation. Other cash payouts are not currently captured.

The settlement interface has local cash and stored-value gift-card tenders. No bank-card/mobile-money gateway, live payment provider, or payment webhooks are integrated. Do not use this release to process online payments. Tax configuration is a business setting, not GRA or accounting advice.

When connectivity drops while the POS page is open, unsynced cart lines are saved in browser storage scoped to the current organization, store, register, and membership. Recovered carts must be reviewed and saved as server-held carts before payment; server stock and shift validation remain authoritative. Offline checkout, offline payment recording, and background synchronization are not supported.

Purchasing marks supplier invoices as past due only when their due date is before the organization's business date and the reconciled balance remains outstanding. Due-today, settled, credited, and undated invoices are not marked overdue; outstanding invoices without a due date are explicitly labeled on their cards. Invoice cards also show when the invoice was recorded and who recorded it when available. New invoice dates default to the organization's business date and are stored as date-only UTC values; invoice creation audit events preserve the normalized date and optional note. When no invoice date is entered, a supplied due date is validated against that same business-date default. Due-date editing uses the invoice's ISO date key for native date-input constraints; invoice, due, payment, and credit dates display their stored calendar date without timezone shifts. Invoice managers see purchasing counts for past-due, due-soon, and undated outstanding invoices, and can filter selected-store purchase orders by those categories. Outstanding invoices due today through the next six calendar days are marked due soon. Invoice managers can add, update, or remove an outstanding invoice's due date, with changes recorded in the audit log and dates before the invoice date rejected. Supplier payments and credits record dates defaulted to the organization business date; future dates are rejected and dates are shown consistently in chronological history. Payment entries accept an optional note, displayed in the payment history and recorded with the payment audit event. Payment and credit history identifies the staff member who recorded each entry when that account is available, and combines payments and credits in newest-first chronological order. Payment and credit-note submissions are idempotent per invoice and payload: exact retries are acknowledged without duplicates, while reused keys with changed details are rejected. Purchase-order reconciliation compares recorded invoice amounts less supplier-issued credits with received value net of returns, using exact-cent arithmetic; payments remain a separate settlement measure. The comparison explicitly reports when net invoiced matches, exceeds, or falls below received net value. Each purchase order also shows aggregate invoice totals, payments, credits, gross remaining payable, and invoice-specific credit balances without offsetting one invoice's credit against another invoice's payable. The dashboard also highlights undated outstanding invoices to help invoice managers complete their due-date records.

The dashboard also shows selected-store outstanding invoice counts and balances for past-due, due-within-seven-days, and undated invoices to owners, managers, and accountants. These balances are operational summaries and are not an accounting statement.

Owners and managers can create organization-wide POS promotion codes with percentage or fixed-amount discounts, optional redemption limits, business-timezone start/end dates, and a minimum subtotal. A promotion can optionally be restricted to selected active products; both the minimum spend and discount then apply only to eligible cart lines. Codes are case-insensitive, can be deactivated, and are revalidated when a held sale is completed; redemptions are counted atomically with checkout. Promotion discounts are snapshotted in sale totals and shown on receipts.

Owners and managers can issue organization-wide GHS stored-value gift cards with optional expiry, inspect masked card balances, and activate or deactivate cards. The management screen paginates through all issued cards, supports lookup by the visible last four code characters and active/inactive/expired filters, and shows an active total across all non-expired active cards in the organization. Owners and managers can download formula-safe organization-wide balance and full transaction CSVs, or export a single card's transaction history, with masked codes, business-timezone dates, event actor names, each event's per-card running balance, event amounts, and exact totals. Expiry dates cannot be set before the organization's business date, and expired cards cannot be reactivated. Each card exposes its latest five value-changing events and links to a role-gated, paginated full transaction history when older activity exists. Activity includes issue, redemption, and refund amounts with actor names, business-timezone timestamps, and related sale numbers where available. The full high-entropy code is shown once at issue; only a SHA-256 hash is stored. POS accepts a gift-card code on a held cart, applies up to its available balance, then atomically rechecks and debits it at checkout with any cash remainder. Manual refunds and item returns restore the gift-card-funded share to the original card; cash-funded shares remain cash refunds and only those amounts are included in register shift reconciliation.

Owners, managers, and accountants can download store-scoped sales/refunds and tax-snapshot CSV exports for the selected 7-, 30-, or 90-day period. The sales export includes saved subtotal, discount, tax snapshot, total, and cash/gift-card tender; refunds are dated when issued and show signed total and tender outflows. The tax export shows each sale's saved rate, post-discount subtotal, recorded tax, and sale total, with refunds as separate signed rows. Because tax allocation for refunds is not stored, the export does not estimate a tax reversal. These exports are operational summaries, not double-entry accounting, a general ledger, or tax-filing advice; review source receipts and current tax guidance before filing.

Customer loyalty earns one point for each full GHS 1 paid and redeems 100 points for GHS 1. Points are stored in an organization-scoped ledger and displayed in POS, customer records, and transaction receipts. Loyalty redemption is customer-linked and cannot be combined with a promotion code or manual discount. Partial refunds and item returns reverse earned points and return redeemed points proportionally; reversals may make the balance negative, in which case new redemptions are unavailable until the balance recovers. Points do not expire and are not cash.

Organization owners can manage employee access from the Team page by inviting new employees, granting existing registered accounts one of the non-owner organization roles, updating roles, assigning one or more active stores and specific POS registers, or removing their access. Owner access cannot be assigned or changed through employee management, and membership/assignment changes are audited. Employees can operate only in their assigned stores and POS registers; owners automatically access all active stores and registers. Invitations require configured SMTP and allow employees to create their own accounts. Removing organization access does not delete the person's account or access to other organizations.

Organization owners can also create, edit, and deactivate stores from Store setup. Store codes are unique within the organization, at least one store must remain active, and a store with an open register shift or employees assigned to no other active store cannot be deactivated. Historical records are retained; tracked products are initialized at zero stock for a new store. When multiple stores are assigned, employees can select their working store from the workspace sidebar; selection is restricted to active stores assigned to their organization membership.

Each store is provisioned with a Main register. Owners can create, rename, and deactivate stations from POS registers; every store must retain an active register, and a station with an open shift cannot be deactivated. Owners have access to every active station, while employees require an explicit station assignment in addition to store access. A station switcher is available in the workspace when multiple stations are assigned.

Organization owners can review audit history from the workspace's Audit history page. Events are scoped to the current organization and show the recorded actor, action, entity, organization-local timestamp, and expandable event details. Search accepts action, actor, or entity text; an action filter and pagination are available. The filtered history can be downloaded as a UTF-8 CSV with spreadsheet-formula protection.

Reports provide 7-, 30-, and 90-day net sales summaries, trends, top products, payment methods, order-status counts, supplier performance (completed orders, units received, and received value), and repeat-customer activity with net spend after refunds. Owner, manager, and accountant roles also see a store-scoped supplier invoice aging report with current balances, outstanding amounts 1–30, 31–60, and 61+ days overdue, and a separate no-due-date bucket, calculated from invoice due dates, payments, and supplier-issued credits as of the organization's business date; the report and both summary and invoice-detail CSV exports include exact grand totals. The detail export includes invoice and PO numbers, dates, days overdue where applicable, original totals, recorded payments/credits, and outstanding balances. Repeat-customer analytics count identified customers with at least two completed sales during the selected period; walk-in sales are excluded and customer names are not shown in the aggregate. Reports also include CSV exports for net sales, sales/refunds, and recorded tax snapshots. Products can be created and edited with a category, GHS selling/cost prices, barcode/SKU, and opening stock; additional named variants can be added and edited with independent SKUs, pricing, barcodes, and store stock. Catalog managers can define reusable organization-wide variant attributes such as Size, Colour, or Material and enter a value for each attribute on each variant; attributes can be reused across products. Products can be archived and restored without deleting stock or sales history. Unused variants may be deleted only when every store has zero stock and there is no reservation, inventory, transfer, sale, or purchasing history; each product keeps at least one variant. The catalog can be exported to CSV for either active or archived products, including variants and selected-store stock levels. Catalog managers can import up to 50 new products at a time from the downloadable CSV template; imports validate every row and either commit all products, stock receipts, and audit events together or import none. Imports do not update existing products. Authorized owner, manager, and inventory-manager roles can record auditable stock adjustments, reconcile physical counts against the quantity shown when the count form was opened, write off damaged units, and transfer available stock between active stores. Stale counts are rejected; adjustments, counts, damage write-offs, and transfers cannot reduce stock below reserved quantities. Customer-facing roles can create, edit, search, deactivate, and reactivate customer records; the directory is paginated, with a recent-orders preview and complete paginated order, item, and payment history plus refunded-net purchase summaries. Supplier-facing roles can create, edit, search, deactivate, and reactivate supplier records. Purchasing roles can create and receive supplier-linked purchase orders, search and filter order history, return received goods with quantity and reserved-stock guards, and cancel orders before receipt. Owner, manager, and accountant roles can record supplier invoices against purchase orders, enter supplier-issued credit notes, and record partial payments; the page shows invoice balances and received stock value less physical returns. Supplier credits are never inferred from returned purchase cost. These records are an operational reconciliation aid, not a general ledger, accounting integration, or external payment execution. The store-scoped order history is paginated and receiving/returns update inventory and typed movement/audit history transactionally. Deactivation preserves supplier records. External payment integration and offline synchronization remain future work.

Before production deployment, configure HTTPS, a managed PostgreSQL service, backups, email verification/password recovery, rate limiting, and the required payment-provider credentials. No payment credentials or raw card data are collected by this application.

- Configurable Ghana tax components: owners/managers set VAT, NHIL and GETFund rates separately (default 0%) with an effective date and visible history under Settings. Each component is calculated on the same post-discount taxable base (not cascaded) and saved on held and completed orders with the combined rate; products carry a STANDARD, ZERO_RATED, EXEMPT or RELIEVED treatment, where only STANDARD items are taxed and the treatment is saved on each sale item. Receipts and the tax snapshot export (new columns appended) show component snapshots; orders from before this feature export as LEGACY_COMBINED_ONLY. The migration backfills a previously configured single rate as a VAT-labelled history row dated 2000-01-01 for owners to review. Rates and treatments are configuration only, not tax advice or a compliance statement; confirm with the Ghana Revenue Authority (https://gra.gov.gh/domestic-tax/tax-types/vat/).
  The GRA page describes the 2026 VAT reforms effective January 1, 2026, including VAT at 15%, NHIL at 2.5%, and GETFund at 2.5% on the same base. Rates remain zero until an owner/manager configures them; eligibility and treatments must be confirmed against current official guidance.

## Administrator guide

The first user registers at `/register` and becomes the organization owner. Owners can grant access to existing accounts only when the account's email is verified; otherwise they invite the employee by email. Invitation links are hashed, expire after 72 hours, are single-use, and create only the selected organization role/store/register assignments. Accepting an invitation verifies control of its email address. New registrations are emailed a single-use verification link (24 hours) and can request another at `/verify-email`; MFA is not implemented. Users can request a password-reset link from `/forgot-password`; SMTP must be configured for delivery. Reset tokens are stored as hashes, expire after 30 minutes, are single-use, and increment the session version so existing sessions are rejected. Removing a membership removes access to that organization but does not delete the user's account or memberships in other organizations.

Organization roles are additive only where a page allows them; store and register assignments also limit access:

| Role | Main administrative capabilities |
|---|---|
| Owner | Manage organization members, stores, audit history, catalog, customers, suppliers, invoices, register operations, and pricing. |
| Manager | Manage catalog, customers, suppliers, invoices, register operations, and pricing. |
| Inventory manager | Manage catalog and suppliers; inventory operations are limited to assigned stores. |
| Cashier | Operate assigned registers and manage customer records. |
| Accountant | Manage supplier invoices and access financial reports and exports. |
| Customer support | Manage customer records. |

Employees must have both store and register assignments to operate a POS station. Owners automatically access all active stores and registers. Review role and assignment changes in the owner-only Audit history page. Password resets revoke existing sessions; per-device session management is not available.

## HTTP endpoints

These are application routes used by the web UI and for operational checks, not a versioned public integration API. Except for health and registration, routes require an authenticated workspace; organization and selected-store data are scoped server-side. CSV downloads use UTF-8, formula-safe cells, and private/no-store caching.

| Method and path | Purpose and parameters |
|---|---|
| `GET /api/health` | Database readiness probe. Returns `200` with `{"status":"ok","database":"connected"}` or `503` with `{"status":"unavailable","database":"disconnected"}`. |
| `POST /api/auth/register` | Public first-owner registration. JSON fields: `ownerName`, `businessName`, `storeName`, `email`, and `password` (at least 12 characters). Returns `201`, `400` for invalid input, `409` for an existing email, or `500` for an unexpected failure. |
| `POST /api/auth/invitations/accept` | Public one-time invitation acceptance. JSON fields: `token`, `name`, and `password` (at least 12 characters). Creates an account and assigned membership only while the link and inviter remain valid. |
| `POST /api/auth/password-reset/request` | Public password-reset request. JSON field: `email`. Always returns the same `202` response for existing and unknown accounts; delivery requires TLS-enabled SMTP configuration. |
| `POST /api/auth/password-reset` | Public one-time password reset. JSON fields: `token` and `password` (at least 12 characters). Invalid or expired tokens return `400`; success revokes existing sessions. |
| `POST /api/auth/email-verification/request` | Public verification-link request. JSON field: `email`. Same `202` response for unknown, unverified and verified accounts; resends are throttled to one per minute. |
| `POST /api/auth/email-verification` | Public one-time email confirmation. JSON field: `token`. Invalid, expired or used tokens return `400`. |
| `POST /api/notifications/scheduled` | Scheduler-only daily job. Requires `Authorization: Bearer <NOTIFICATIONS_CRON_SECRET>` with a 32-character minimum secret; see Business notifications above. |
| `GET /products/export?q=...&status=active\|archived` | Keyset-streamed catalog CSV with variants and selected-store stock. Active is the default. |
| `GET /inventory/export?q=...&status=all\|low\|out` | Keyset-streamed selected-store inventory CSV. Unknown status values use `all`. |
| `GET /reports/export?days=7\|30\|90` | Selected-store net sales trend CSV. Unsupported periods use 30 days. |
| `GET /reports/accounting-export?days=7\|30\|90` | Financial-role sales, tender, and refund CSV. |
| `GET /reports/tax-export?days=7\|30\|90` | Financial-role saved tax snapshot CSV; refund tax allocation is not inferred. |
| `GET /reports/supplier-invoice-aging` | Financial-role supplier aging summary CSV. Add `?detail=invoices` for invoice-level details. |
| `GET /audit-logs/export?q=...&action=...` | Owner-only filtered audit CSV. |
| `GET /gift-cards/export` | Owner/manager organization gift-card balance CSV. |
| `GET /gift-cards/transactions/export` | Owner/manager organization gift-card ledger CSV. Add `?giftCardId=...` for one card. |

Reports are limited to the currently selected store unless explicitly described as organization-wide. Do not treat operational CSV reports as a general ledger, tax filing, or a supported integration contract.

## Deployment and operations runbook

### Routine deployment

1. Confirm production secrets, HTTPS `AUTH_URL`, database connectivity, and sufficient disk space. Keep `.env` and database archives out of source control.
2. Take and verify a database backup before schema or application upgrades using the backup procedure above. Copy the archive to protected off-host storage.
3. Build the production app and migration images, ensure PostgreSQL is healthy, and apply migrations before bringing up the new app:

   ```powershell
   docker compose build app migrate
   docker compose up -d db
   docker compose ps
   docker compose run --rm migrate
   docker compose up -d --no-deps app
   ```

4. Verify `docker compose ps` reports the app healthy and `curl.exe -i http://localhost:3000/api/health` returns HTTP 200. Review the app and migration logs before announcing the deployment.

Do not roll back only the app image after a database migration. If a release must be reverted, use a compatible prior application image and the migration's documented rollback strategy; if data restoration is required, restore a verified pre-upgrade backup and explicitly account for transactions recorded after it.

### Monitoring and incident response

- Readiness probe: `GET /api/health`; HTTP 503 means the app cannot complete its database check. It is not a full business-workflow or external-dependency check.
- Inspect services and recent logs:

  ```powershell
  docker compose ps
  docker compose logs --tail=100 app migrate db
  ```

- If migrations fail, keep the deployment in maintenance, inspect the migration logs and database state, and do not repeatedly rerun an unknown partial/manual schema change. Restore or repair using a verified plan before restarting the app.
- If PostgreSQL is unavailable, check the database container health, storage capacity, and configured credentials. A persistent Docker volume survives container replacement but does not protect against host or volume loss.
- If sign-in or callbacks fail after changing the public origin, verify `AUTH_URL` exactly matches the HTTPS origin and that `AUTH_SECRET` is stable and privately stored. Replacing the secret invalidates existing sessions.
- Treat audit history, exports, and backups as sensitive business data. Limit operator access, encrypt backups at rest and in transit, and retain them according to the business's data policy.

### Backup and restore policy

Choose and document an organization-specific backup cadence and retention period; this repository cannot schedule backups or verify off-host copies. After each backup, confirm archive validation succeeds, transfer it to protected off-host storage, and record its date and destination without recording credentials. Periodically test a restore in an isolated environment and verify representative business records and application health before relying on the procedure.

The provided restore helper is destructive for objects contained in the archive, requires the exact target confirmation, stops the app, and leaves it stopped on failure. Restore only after confirming the database target and backup provenance. The helper does not remove objects created after the backup, so a restore is not a point-in-time recovery mechanism.

## Checks

- `npm run typecheck`
- `npm test`
- `npm run build`
