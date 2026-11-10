# Development progress

## Product direction

Build an independent Ghana-focused retail POS and commerce platform with Ghana cedi (GHS) defaults, `Africa/Accra` timezone, tenant-isolated business data, and support for configurable Ghana tax rules. This is a staged implementation; a module is not complete until its persistence, authorization, error handling, and tests are in place.

## Architecture

- Next.js App Router + React + TypeScript.
- PostgreSQL + Prisma for transactional, relational retail data.
- Auth.js credentials sessions; bcrypt password hashes; Zod input validation; provider-neutral TLS SMTP for account recovery (deployment configuration required).
- Tailwind CSS v4 and a small in-house responsive design system.
- GHS as the new-business currency; no payment provider integration is claimed.

## Roadmap and status

### Phase 1 — Foundation (in progress)
- [x] Establish Next.js/TypeScript application structure and shared UI foundation.
- [x] Add PostgreSQL schema for organizations, memberships, stores, catalog, customers, inventory movements, orders, payments, and audit records.
- [x] Implement owner registration with atomic organization, owner membership, and first-store creation.
- [x] Implement credential sign-in with bcrypt password verification and bounded session lifetime.
- [x] Add organization-scoped, database-backed dashboard metrics.
- [x] Generate the initial PostgreSQL migration from the validated schema.
- [x] Add currency/onboarding unit tests and pass type, lint, build, and dependency checks.
- [x] Create and verify the local application database/role and apply the initial PostgreSQL migration.
- [x] Add role/permission enforcement, invitation flow, email verification, password reset, and session revocation. Role checks, owner-issued email invitations with scoped store/register assignments, single-use email-verification links sent at registration (resendable at `/verify-email`), password-reset tokens, and session-version revocation are implemented; owners can add existing accounts directly only when the email is verified.

### Phase 2 — Core retail management
- [x] Product/category/default-variant creation with GHS pricing, SKU/barcode validation, tenant-scoped uniqueness, search, opening stock, and audit records.
- [x] Active/archived catalog CSV export with search preservation, all variants, selected-store stock, and formula-safe cells.
- [x] Validated, role-gated, atomic CSV import for up to 50 new products with a downloadable template, opening-stock receipts, and audit events.
- [x] Add and edit multiple named product variants with unique SKUs, pricing, barcodes, and per-store opening stock.
- [x] Delete unused variants only when they have zero stock and no reservation, inventory, transfer, sales, or purchasing history; always retain at least one variant per product.
- [x] Define reusable organization-level product attributes and assign attribute values to variants.
- [x] Edit product details/default variant pricing; archive and restore products while preserving inventory and order history.
- [x] Complete paginated customer purchase history, including item/payment details and preserved archived-customer access.
- [x] Tenant-scoped supplier directory with create, search, edit, reversible deactivation, audit events, and inventory-role authorization.
- [x] Tenant-scoped customer creation, search, editing, deactivation/reactivation; paginated directory, latest-order preview, complete paginated order history; paid-order counts/spend, role checks, and audit events.
- [x] Per-store stock records, initial receipt ledger, concurrency-safe stock adjustments, negative-available-stock protection, low-stock indicators, and audit trail.
- [x] Paginated, searchable per-store inventory listing by product, variant, SKU, barcode, and category.
- [x] Searchable, paginated inventory movement history by product, SKU, movement type, and reason.
- [x] Per-variant physical counts with stale-count protection, reserved-stock guard, adjustment ledger, and audit event.
- [x] Damaged-stock write-offs with unreserved-quantity guard, movement ledger, and audit event.
- [x] Reserve tracked stock for persisted held POS carts; release it transactionally on checkout or void, and include each cart's own reservation when resuming/editing.
- [x] Owner-managed organization employee access for existing accounts, with manager, cashier, inventory-manager, accountant, and customer-support roles; owners only and ownership protected.
- [x] Owner-managed store creation, editing, and reversible deactivation with unique organization codes, active-store/shift safeguards, audit history, and zero-stock inventory initialization.
- [x] Switch active store from the workspace; selection is validated against active stores in the current organization.
- [x] Assign non-owner employees to one or more active stores; enforce assignments during workspace and store selection, with owners retaining all-store access.

### Phase 3 — POS engine
- [x] Persisted register shift opening/closing with cash float, counted close, variance record, single-open-shift guard, and audit events.
- [x] Reconcile expected drawer cash from opening float, successful cash sales, and cash refunds; show counted close and variance.
- [x] Persist and resume held carts; reserve tracked stock until checkout or void; calculate configurable tax and manager-only discounts; snapshot line prices, discounts, tax, and rate.
- [x] Complete atomic, idempotent cash checkout with tracked-stock validation, stock movements, payment records, and audit events.
- [x] Provide manager-only cash refunds and item returns, per-line quantity limits, optional inventory restocking, movement records, and audit events.
- [x] Add manager-authorized held-sale voids, paginated/searchable transaction history, and tenant/store-scoped printable receipts.
- [x] Add the payment settlement abstraction with a cash-only implementation; external payment providers, online payments, and webhooks are intentionally not included.

### Phase 4 — Business operations
- [x] Supplier-backed purchase orders with partial/full receiving, safe cancellation before receipt, and audited inventory/order events.
- [x] Store-scoped purchase-order search by supplier, order number, item, SKU, or notes; status filtering and pagination.
- [x] Store-scoped sales reports for selectable 7-, 30-, and 90-day periods using persisted orders and payments.
- [x] Supplier performance reporting for completed orders, received units, and received value by reporting period.
- [x] Record supplier invoices per purchase order, supplier-issued credit notes, and partial payments with outstanding balance reconciliation.
- [x] Partial supplier returns against received purchase-order quantities with stock guards and audit trail.
- [x] Atomic, audited inter-store transfers with paired movement entries and reserved-stock protection.
- [x] Organization-wide percentage/fixed POS promotions with optional redemption caps, audited activation, tenant validation, and atomic checkout redemption.
- [x] Optionally restrict promotions to selected active products; calculate discounts and minimum spend from eligible cart lines and revalidate eligibility at checkout.
- [x] Customer loyalty points with paid-sale earning, POS redemption, auditable transaction history, and refund/return reversal.
- [x] Organization-scoped GHS stored-value gift cards with one-time code display, hashed code storage, expiry/deactivation controls, POS split tender, concurrent balance checks, and refund/return value restoration to the original card.
- [x] Store and named register workflows with employee assignments and operational safeguards.
- [x] Create named POS registers per store, assign employees to specific stations, and isolate shifts/POS actions by assigned register.

### Phase 5 — Advanced capabilities
- [x] Offline cart persistence and conflict-safe synchronization to a server-held cart, scoped to the organization/store/register/membership and subject to existing server-side stock/shift validation; offline payment completion remains intentionally unsupported.
- [x] Support keyboard-wedge barcode scanners in POS by adding uniquely matched active variants on Enter.
- [x] Role-gated store sales/refund and tax-snapshot CSV exports with signed refund flows and spreadsheet-formula-safe cells; refund tax allocation is explicitly not inferred, and exports are operational rather than tax filings.
- [x] Tenant/store/role-scoped in-app and email notifications for low stock, supplier follow-ups, due/overdue invoices, and daily sales summaries, with a bearer-protected provider-neutral scheduler endpoint.
- [ ] Hardware integration points; printer, scanner, payment terminal and fiscal-device models/providers remain deferred until deployment.
- [x] Configurable Ghana VAT, NHIL and GETFund rates with effective dates/history, per-product treatments, held/completed-sale snapshots, receipts, and operational tax export. Rates default to zero and require owner configuration; settings are not tax advice or a compliance statement.
- [x] Store-period repeat-customer count/rate and net spend based on completed orders and recorded refunds.

### Phase 6 — Quality and deployment
- [x] Unit, route/action, and end-to-end coverage for critical workflows. The complete organization-role permission matrix is unit-tested. The full unit suite passed (281 tests); targeted POS/gift-card tests passed after the no-expiry gift-card fix; and Playwright passed all 26 desktop/mobile tests. Browser flows cover login/registration, cash POS checkout, offline-cart recovery and synchronization, promotions, gift-card tender, refunds, customer returns/restocking, supplier invoices/returns, purchasing/report totals, and platform-admin subscription management. The platform spec creates and removes a temporary platform admin and temporarily restricts the `starter` package, restoring it afterwards; run it only against a local or disposable database.
- [x] Targeted security and tenant-isolation review, performance checks, and production build. A targeted review fixed unverified-email direct membership grants; a tenant-isolation sweep scoped refund idempotency lookups by organization; sign-in is throttled per email (8 failures per 15 minutes, in-process); tenant-scoped indexes on orders, inventory, movements, audit logs, customers and products were reviewed; and `npm run build`, lint, and typecheck passed. Migration `20261110110000_pg_trgm_search_indexes` adds 27 `pg_trgm` GIN indexes for substring-search fields; it was applied and verified in Docker, including an index-backed query plan. A production-server load test (`scripts/load-test-seed.mjs`, `scripts/load-test.mjs`) seeded 20k products, 10k customers and 50k orders, ran 10 connections for 3 seconds per endpoint, and completed with no request errors or non-2xx responses. Measured p50 latency ranged from 112 ms (audit logs) to 1,040 ms (customer search); reports were 940 ms p50. This was a targeted review and local synthetic benchmark, not an external security audit or production-capacity guarantee.
- [x] Add a standalone production Docker image, least-privilege app database role, health checks, ordered migrations, PostgreSQL persistence, and backup/restore instructions.
- [x] Document Docker deployment and upgrades, backup/recovery procedures, HTTP routes, administrator roles, and operational monitoring/troubleshooting.

## Current development snapshot

- The dashboard now lists up to five lowest-stock tracked variants at or below reorder point for the selected store, including on-hand and reserved quantities, and links directly to inventory.
- Notifications are listed in the authenticated workspace, scoped to memberships, assigned active stores, and current role permissions. The external scheduler runs daily at 00:15 UTC by default; each workspace uses its timezone to summarize the previous business day and identify operational reminders. SMTP delivery uses the existing provider-neutral TLS settings.
- Product catalog results now paginate through all matching active or archived products while preserving search and catalog status filters.
- Supplier directory results now paginate through all matching active or inactive suppliers while preserving search and directory status filters.
- Promotion management paginates through every organization promotion, displays the full active count, and POS loads the complete active-code set.
- Register-shift history now paginates all open and closed shifts for the assigned register, retaining the current-shift summary and cash reconciliation.
- POS preserves unsynced cart lines in browser storage when connectivity drops and restores them in the matching organization/store/register/membership context. Sync requires a server-validated held cart; optimistic version checks prevent overwriting concurrent edits, conflicts keep the local copy and block checkout, and offline checkout remains disabled.
- Offline payment completion remains disabled by explicit product choice; offline cart lines can only be synchronized as a server-held cart and checked out after server validation.
- Password recovery uses one-time 30-minute token hashes, per-account request throttling, non-enumerating responses, TLS-only SMTP settings, and session-version checks that reject sessions issued before a reset.
- Employee invitations use owner authorization, one-time token hashes with 72-hour expiry, transactionally revalidated store/register assignments, atomic account/membership creation, invitation-based email ownership verification, and SMTP delivery.
- Ghana tax configuration stores VAT, NHIL, and GETFund component rates by effective date; checkout applies each to the same discounted base for STANDARD products and snapshots the rates, component totals, and product treatments on held and completed sales. Legacy combined-rate sales remain labelled as legacy in exports.
- The low-stock notification link opens the inventory's supported `low` filter; SMS/WhatsApp and hardware remain deferred until provider and device choices are made.
- Production deployment now has a standalone multi-stage Docker image, PostgreSQL Compose service with persistent storage, a one-shot migration service, a database readiness endpoint, and documented backup/restore commands.
- Application responses include baseline MIME-sniffing, framing, referrer, and browser-permission security headers.
- All organization roles are covered by a least-privilege permission-matrix test for catalog, customers, suppliers, invoices, member/store administration, register operation, and pricing.
- Supplier invoice aging helpers reject impossible calendar dates and invalid due-soon ranges instead of relying on string-shape checks.
- The database health endpoint has regression tests for both connected and unavailable responses, including status codes, cache headers, and failure logging.
- CSV formula protection preserves canonical negative decimal values as numeric cells while continuing to neutralize negative formula-like text and identifier strings.
- Product CSV import tests cover duplicate/unsupported headers and the exact 50-product batch boundary.
- Organization owners can review a tenant-scoped, paginated audit history with actor, action, entity, organization-timezone timestamp, and expandable event details.
- Audit history can be searched across action, actor, and entity fields or filtered by organization-observed action types, preserving filters while paging.
- Owners can export filtered audit history as formula-safe CSV; the export preserves tenant scope and uses bounded keyset batches.
- Audit CSV export route tests verify owner-only workspace access, organization/filter predicates, CSV formula neutralization, and keyset pagination.
- Tax snapshot export route tests verify accountant access, cashier denial, selected-store and date-window scoping, saved tax values, and refund caveats.
- Sales accounting export route tests verify accountant access, cashier denial, selected-store and date-window scoping, cash/gift-card tender totals, and signed refund splits.
- Sales-trend export route tests verify store/timezone parameterization, supported and fallback report periods, CSV metadata, and returned trend rows.
- Supplier invoice-aging export route tests verify accountant access, cashier denial, organization/store query scoping, summary totals, invoice-level payments/credits, undated invoices, and formula-safe CSV identifiers.
- Inventory export route tests verify store scoping, low-stock and fallback filters, formula-safe CSV cells, available-stock calculations, and keyset batch continuity.
- Product catalog export route tests verify active/archived filters, search and store-level stock selection, formula-safe output, and keyset pagination across batches.
- Product catalog action tests verify CSV import validation, catalog-role enforcement, organization-scoped duplicate-SKU rejection from preflight and database constraints, manual product and variant creation, tenant-scoped product/option validation, atomic product/stock/movement/audit writes, transaction failure logging, and cache revalidation only after success.
- Inventory action tests cover role and input gates, tenant/store scoping, reserved-stock protection, stale count/reorder-point checks, atomic stock adjustments, physical counts, damaged-stock write-offs, inter-store transfers with paired movements, audit writes, and successful cache invalidation.
- POS cash-checkout action tests cover assigned-register and tenant/store scoping, reserved-stock consumption, payment/change records, reservation release, order/audit updates, closed shifts, conditional stock failures, and role denial.
- POS split-tender checkout tests verify gift-card balance locking/debit and redemption ledger entries alongside cash settlement of the remaining balance.
- Held-sale void action tests cover manager authorization, assigned-register and tenant/store scoping, reservation release, cancelled-order/audit updates, and preservation of the held cart when reservation data is inconsistent.
- POS refund action tests cover manager authorization, tenant/store-scoped partial cash refunds, idempotency lookup, refund limits, open-shift reconciliation, payment/order status updates, audit records, and over-refund rejection.
- POS item-return action tests cover scoped sale-item lookup, remaining-quantity enforcement, proportional refunds, inventory restocking and movement records, payment/order updates, and audit history.
- Offline-cart synchronization tests verify stale held-cart versions return a conflict without releasing or changing the server reservation, order, or audit trail.
- README documents administrator role scope, available HTTP routes and parameters, Docker deployment/migration steps, health/log monitoring, and backup/recovery operational safeguards.
- README documents audit-history ownership, organization scoping, search/action filters, local timestamps, and CSV export behavior.
- Docker PostgreSQL backups can be created with a timestamped PowerShell helper that verifies the custom-format archive and removes incomplete output.
- Docker PostgreSQL backups use unique names and refuse to overwrite existing files; Windows PowerShell-compatible restores validate a safely named in-repository backup, require exact database-target confirmation, stop the app before restore, and leave it stopped on failure.
- Gift-card expiry comparisons now require valid ISO calendar dates for both expiry and business date, using the shared date validator.
- POS promotion eligibility revalidates optional start/end and business dates as real calendar dates before inclusive schedule comparisons.
- The shared ISO calendar-date validator has direct leap-day, month-boundary, and canonical-format unit coverage.
- Promotion, gift-card, supplier follow-up, and purchase-order date input schemas now reuse the shared strict calendar-date validator.
- Registration route tests cover malformed and invalid input, atomic Ghana owner/store/register creation, password hashing parameters, normalized email, and duplicate-email conflicts.
- Audit history uses a composite organization/action/date/ID index to support filtered chronological reads and keyset exports.
- Signed cent formatting now preserves negative sub-dollar values in supplier invoice reconciliation, including credits and received-value differences.
- Catalog managers can edit a variant's reorder point per selected store from inventory; updates validate bounds, reject stale values, and create audit records.
- Inventory supports store-scoped low-stock and out-of-stock filters that preserve product search and pagination.
- Inventory exports a store-scoped, formula-safe CSV containing on-hand, reserved, available, reorder point, barcode, and stock status, respecting the current search and stock-status filter.
- Inventory table and CSV include the quantity needed to bring available stock up to reorder point, explicitly not a purchase recommendation.
- Inventory managers can open a draft purchase order prefilled with a selected variant and its reorder-threshold quantity; supplier, quantities, and costs remain editable.
- Purchase orders have a print-only supplier-facing view with ordered items, costs, delivery details, and notes, omitting internal receiving and invoice controls.
- Purchasing surfaces open purchase orders past their expected delivery date, using the organization business date, with an overdue count, badge, and filter.
- Purchasing staff can record audited supplier contact attempts on overdue open orders, with a contact method, summary, optional next follow-up date, and visible recent history.
- Scheduled supplier follow-ups are summarized, filterable by due date, and can be rescheduled through a new audited contact entry.
- Outstanding supplier invoices past their due date are marked overdue; paid, credited, due-today, and undated invoices are not.
- Invoice managers see purchasing counts for past-due, due-soon, and undated outstanding invoices, with selected-store order filters for each category.
- Outstanding supplier invoices due within the next seven business-calendar days are highlighted and filterable in purchasing by invoice managers.
- The dashboard shows selected-store outstanding supplier invoice balances due now or within seven days to invoice managers.
- Reports include a selected-store supplier aging table for undated balances, current balances, and 1–30, 31–60, and 61+ days overdue, limited to invoice managers.
- Invoice managers can download a formula-safe CSV of supplier aging buckets with current balances, counts, store, currency, and as-of business date.
- A separate invoice-detail aging export lists supplier invoice and PO numbers, due dates, days overdue, recorded payments/credits, and remaining balances.
- Outstanding invoices with no due date are shown separately in the aging report and exports, so they are not silently omitted or counted as overdue.
- Purchasing filters and the invoice-manager dashboard surface outstanding invoices missing due dates, with store-scoped balances and purchase-order links.
- Invoice managers can add, change, or remove due dates on outstanding supplier invoices; changes are audited and dates before the invoice date are rejected.
- Supplier invoice dates default to the organization's business date and are stored as date-only UTC values, matching explicit invoice dates and aging calculations.
- Due dates entered without an explicit invoice date are validated against the same business-date default that will be stored.
- Due-date editing uses the invoice's ISO calendar-date value for the native date input constraint while retaining localized display dates.
- Supplier invoice creation audit events capture the normalized invoice date and optional note along with the invoice and purchase-order identifiers and amount.
- Supplier payments record a validated payment date, defaulted to the business date and disallowing future dates; the date participates in idempotency checks and chronological history.
- Supplier credit notes record a validated issue date, defaulted to the business date and disallowing future dates; the date participates in idempotency checks and chronological history.
- Invoice, due, payment, and credit calendar dates are displayed in UTC so their stored date-only values cannot shift under an organization timezone.
- Individual outstanding supplier invoice cards are visibly marked when their due date is missing; settled and credited invoices are not flagged.
- Purchase-order invoice reconciliation shows recorded invoices less supplier-issued credits and the exact-cent difference from received value net of returns; payments remain a separate settlement measure.
- Reconciliation text explicitly indicates whether net invoiced matches, exceeds, or falls below received net value.
- Purchase-order invoice panels summarize aggregate invoices, payments, credits, gross remaining payable, and invoice-specific credit balances without offsetting credits against other invoices.
- Supplier payment entries support optional notes, visible in payment history and captured in the payment audit event.
- Supplier payment and credit-note history identifies the staff member who recorded each entry when that account remains available.
- Supplier invoice cards show when the invoice was recorded and who recorded it when the account remains available.
- Supplier payments and credits are presented together in newest-first chronological invoice history.
- Replayed supplier payment and credit-note idempotency keys are checked against the scoped invoice and original payload; exact retries are acknowledged while reused keys with changed details are rejected.
- Supplier aging reports and summary CSV exports include exact grand totals across all visible suppliers and aging buckets.
- Invoice-detail aging CSVs also include exact total invoice amounts, payments, credits, and outstanding balances.
- Platform administrators can start one audited 30-day trial or activate/renew a paid subscription using an unused, non-voided manually recorded payment. Package features and active-store/staff limits are enforced across workspace pages, server actions, exports and shared receipts; expired subscriptions are read-only, while unassigned legacy businesses retain existing access.
- Completed in this iteration: tenant-scoped product creation, editing, archival/restoration, catalog search, and validated atomic CSV import (maximum 50 new products per file); multi-variant creation and editing with per-store inventory initialization; GHS pricing and barcode/SKU validation; transactional opening inventory and stock adjustment workflows; per-variant physical stock counts reconciled with optimistic stale-count protection, reserved-stock guard, movement ledger, and audit event; damaged-stock write-offs limited to available unreserved units, recorded in a `DAMAGE` movement and audit event atomically; atomic multi-store stock transfers with row locking, reserved-stock protection, paired incoming/outgoing ledger entries, transfer history, and audit events; per-store paginated/searchable stock view, low-stock status, searchable paginated movement history, and audit events. Catalog exports include all matching variants, safe CSV values, and store-scoped stock levels for the selected active/archived status. Imports create new products only, reject duplicates, validate all rows before writing, and record opening stock and audit events transactionally. Archiving preserves inventory and order records while removing products from active stock counts and adjustments. Duplicate-SKU errors from Prisma's PostgreSQL driver adapter are reported as validation feedback rather than a generic save failure. Customer directory supports tenant-scoped create, edit, deactivate/reactivate, search, pagination, input validation, role gating, audit records, refunded-net purchase summaries, a recent order preview, and complete paginated order/item/payment history including inactive customers. Supplier directory supports tenant-scoped create, edit, deactivate/reactivate, search, role gating, and audit events. Purchasing supports searchable, status-filtered, paginated store-scoped order history, supplier-linked purchase orders, partial/full receipts, safe cancellation before receipt, audited partial supplier returns of received goods with per-line return limits and reserved-stock protection, and per-PO supplier invoices with manual invoice totals, due dates, credit notes, partial payments, running balance/status, audit events, and a comparison to received inventory value net of returns. Supplier credits are recorded from an actual supplier credit note and never inferred from return cost. The UI distinguishes invoice payments and credits from physical stock returns; supplier balance tracking is an operational record, not an accounting integration. POS supports persisted held carts with tracked-stock reservations (released transactionally on checkout or void, and credited back while resuming a cart), cash checkout, configurable tax and manager-only discounts with price/tax snapshots, manager-only voids/refunds/item returns, optional return restocking, sale movement history, paginated transaction search, printable receipts, and idempotency keys. Shift expected cash is opening float plus completed cash sales less refunds recorded during that shift; counted-close variance is compared to that expected balance. All return, refund, inventory movement, payment, invoice, credit, and audit writes are transactional. The POS settlement interface currently implements cash only: no online provider, card/mobile-money processing, or gateway webhooks are claimed. Dashboard and reports include recorded refunds when calculating net sales. Reports provide store-scoped 7-, 30-, and 90-day net sales summaries, daily/weekly trend bars, top products, payment method totals, order status breakdowns, supplier order completion rates, received units and received value, and authorized net sales-trend CSV export using persisted transactions. Authentication redirects check for an existing workspace before forwarding signed-in users, preventing stale/orphaned sessions from looping between the dashboard and registration page. Organization owners can manage existing accounts from `/team`, assign non-owner organization roles, update roles, assign one or more active stores, and revoke organization membership. Membership and assignment changes serialize against the organization record and produce audit events; current ownership is rechecked inside each transaction and an organization cannot lose its last owner. A migration backfills all existing memberships to their current stores. Owner-only store setup at `/stores` creates, edits, and deactivates locations without deleting history; codes are organization-unique, at least one active store must remain, and stores with open register shifts or employees who would lose all active locations cannot be deactivated. New stores receive zero-quantity inventory records for tracked variants. Staff can switch only among assigned active stores, with selection validated against their organization membership and stored in an HTTP-only cookie. Dashboard sales, refund, order, and low-stock summaries are scoped to the selected store.
- POS register management: stores have named register stations; employees can be assigned only to selected stations within their assigned stores; shift opening, checkout, refunds, returns, and held-cart operations are scoped to the active station. Existing stores/shifts and assigned employees are migrated to a default Main register. Owner-managed station creation/renaming/deactivation is audited; active shifts and last-active-station safeguards are enforced.
- Product option attributes: organization-level attributes can be created once and reused across products; variants store their own optional values, with tenant-scoped foreign keys and audit events.
- POS promotions: owners/managers create organization-wide fixed or percentage codes with optional redemption caps, business-timezone schedules, and minimum spend; codes are revalidated on held-cart save and checkout, counted transactionally, and shown on receipts.
- Customer loyalty: earn one point per full GHS 1 paid and redeem 100 points for GHS 1; refund/return reversals are proportional and the ledger is tenant-scoped.
- Stored-value gift cards: owners/managers issue organization-scoped GHS cards, with raw codes shown only at issue and only SHA-256 hashes persisted. Expiry dates cannot precede the organization's business date, and expired cards cannot be reactivated. The management screen paginates through all cards, supports search by the visible last four code characters and active/inactive/expired filters, counts all non-expired active cards organization-wide, and shows each listed card's latest five issue, redemption, and refund transactions with actor, business-timezone timestamp, and related sale number where available; older activity links to a role-gated, paginated full card history. Owners and managers can download formula-safe organization-wide balance and transaction CSVs or an individual card's transaction CSV, with masked codes, event actor names, per-card running balances, and exact totals. The transaction CSV streams in keyset-paginated batches while retaining running balances and exact totals across batch boundaries. Held carts apply available balance, checkout locks and debits the card atomically alongside cash tender, and proportional manual refunds/item returns credit gift-funded value back to the same card; only cash portions affect shift reconciliation.
- Sales/refund export: owners, managers, and accountants can download a store-scoped CSV for the selected 7-, 30-, or 90-day period. Completed-sale rows include saved tax and tender totals; refunds appear by refund date with negative total, cash, and gift-card flows. This is an operational summary, not double-entry accounting, a general ledger, or tax advice.
- Tax snapshot export: authorized financial roles can export saved per-sale tax-rate, post-discount subtotal, tax amount, and sale total. Refunds are separate negative-value rows and do not assume a tax reversal because allocation data is not persisted.
- Customer retention reporting: reports show distinct customers with completed sales, repeat customers with at least two completed sales during the selected period, repeat-customer net sales after refunds, and repeat-customer share. Walk-in sales are excluded and customer names are not exposed in the aggregate.
- Configurable Ghana tax components: owners/managers set VAT, NHIL and GETFund rates separately (default 0%) with an effective date and visible history under Settings. Each component is calculated on the same post-discount taxable base (not cascaded) and saved on held and completed orders with the combined rate; products carry a STANDARD, ZERO_RATED, EXEMPT or RELIEVED treatment, where only STANDARD items are taxed and the treatment is saved on each sale item. Receipts and the tax snapshot export (new columns appended) show component snapshots; orders from before this feature export as LEGACY_COMBINED_ONLY. The migration backfills a previously configured single rate as a VAT-labelled history row dated 2000-01-01 for owners to review. Rates and treatments are configuration only, not tax advice or a compliance statement; confirm with the Ghana Revenue Authority (https://gra.gov.gh/domestic-tax/tax-types/vat/).
- Validation: PostgreSQL migrations, production Docker build, lint, typecheck, unit tests and desktop/mobile browser workflows have been checked locally. A targeted synthetic load test and its limitations are recorded under Phase 6. Live SMTP delivery remains unverified until deployment settings are supplied.
- Local setup: PostgreSQL 17 is installed and running. The ignored `.env` contains generated local credentials; the PowerShell bootstrap created/verified the `saleserp_app` role and `saleserp` database. `prisma migrate deploy` successfully applied the gift-card transaction export index migration.
- Known limitations: the workspace UI uses the first organization membership; non-owner POS access requires both an assigned store and assigned active station; tax rates and treatments are configuration only (not tax advice). Email-verification links are implemented but depend on deployment email configuration; MFA is not implemented. Offline checkout remains intentionally disabled. SMS/WhatsApp, payment-provider processing, and hardware integrations remain deferred until providers/devices are selected. The standalone legacy mockup and its rewrite script have been removed; the Next.js app is the sole application runtime.
- Required external setup: PostgreSQL connection, production auth secret, and TLS SMTP settings for password recovery, invitations, and email notifications; the scheduler must call the protected notification endpoint daily. Payment-provider credentials and hardware access are needed only if those integrations are later selected.
