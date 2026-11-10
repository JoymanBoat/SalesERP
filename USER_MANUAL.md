# Keta Retail user manual

This manual explains how to set up and use Keta Retail for day-to-day retail operations. Features and available actions depend on your access role, store and register assignments, and deployment configuration.

## Contents

1. [Getting started](#1-getting-started)
2. [Navigating and access roles](#2-navigating-and-access-roles)
3. [Stores, registers and team](#3-stores-registers-and-team)
4. [Products and stock](#4-products-and-stock)
5. [Customers and suppliers](#5-customers-and-suppliers)
6. [Purchasing](#6-purchasing)
7. [Selling at the point of sale](#7-selling-at-the-point-of-sale)
8. [Refunds and returns](#8-refunds-and-returns)
9. [Promotions, loyalty and gift cards](#9-promotions-loyalty-and-gift-cards)
10. [Tax settings](#10-tax-settings)
11. [Reports, notifications and audit history](#11-reports-notifications-and-audit-history)
12. [Daily checklist](#12-daily-checklist)
13. [Troubleshooting](#13-troubleshooting)
14. [Current limitations and safety](#14-current-limitations-and-safety)

## 1. Getting started

### Open the application

- On the computer hosting the application, open `http://localhost:3000` if it is running on the default port.
- On a phone or another computer on the same local network, use `http://<laptop-ip-address>:3000`. For example, if the laptop's current Wi-Fi address is `192.168.0.100`, open `http://192.168.0.100:3000`. The address can change, so check the laptop's current Wi-Fi IPv4 address if it stops working.
- `localhost` on a phone refers to the phone itself, not the laptop. Both devices must be able to reach each other, and the laptop's firewall must allow the connection. Ask the person managing the laptop for help.
- For development testing, the administrator must set `AUTH_URL` in the laptop's `.env` to that same network address and restart the development server. If the laptop's IP changes, update the setting and restart again.

The local HTTP connection is **not encrypted**. Use it only for isolated testing on a trusted network with test data and test passwords. For real business data or internet access, an administrator must configure HTTPS, secure hosting, access controls and backups. Do not expose the development or local test server directly to the internet.

### Create a business account

1. On the sign-in page, choose **Create a business account**.
2. Enter your name, business name, first store name, business email and password. The password must contain at least 12 characters.
3. Select **Create business account** and wait for the result.
4. On success, the application opens the sign-in page and displays **Your business account is ready. Sign in to continue.** Sign in with the email and password you just chose.
5. If an error appears, read it and correct the indicated issue. If the connection is interrupted after submission, try signing in before attempting to register again: the request may have completed even though the response did not reach your device.

Registration creates the owner account, organization, first store and its Main register together. New businesses default to Ghana cedis (GHS) and the `Africa/Accra` business timezone.

### Sign in and sign out

1. Open **Sign in**, enter your email and password, and select **Sign in**.
2. After signing in, use the workspace navigation to reach your tasks.
3. Select **Sign out** in the sidebar when finished, especially on a shared device.

If you are already signed in to a business, opening the registration or sign-in page normally sends you to the dashboard. Sign out first if you need to use another account.

### Reset a forgotten password

1. On the sign-in page, select **Forgot your password?**
2. Enter your account email and submit the request.
3. If an eligible account exists and email delivery is configured, open the email and follow the one-time link within 30 minutes.
4. Choose a new password of at least 12 characters, then sign in again. Existing sessions are revoked.

The request confirmation is deliberately the same whether an account exists or not. If no email arrives, check spam and ask your administrator whether SMTP delivery is configured and working.

## 2. Navigating and access roles

The workspace navigation includes **Overview**, **Products**, **Inventory**, **Customers**, **Suppliers**, **Purchasing**, **Point of sale**, **Register shifts**, **Reports** and **Notifications**. Additional management pages appear when your role permits them.

Select your working store and POS register using the sidebar selectors when you have more than one available. Check both selections before recording stock, purchases, sales or reports: many records are scoped to the selected store, and POS activity is scoped to the selected register and its open shift.

| Role | Main responsibilities |
|---|---|
| Owner | All-store and all-register access; manage team, stores, registers and audit history; perform management tasks. |
| Manager | Manage catalog, inventory, suppliers, purchasing, promotions, gift cards, tax settings and POS management tasks. |
| Cashier | Operate an assigned register and manage customers. |
| Inventory manager | Manage catalog, stock, suppliers and purchasing. |
| Accountant | Manage supplier invoices, payments and credits, and access financial reports and exports. |
| Customer support | Manage customer records. |

This table highlights common permissions, not every screen or action. Owners and managers can perform sensitive POS actions such as manual discounts, held-sale voids, refunds and returns. If a button is missing or access is denied, ask the owner to check your role and assignments rather than sharing another person's account.

## 3. Stores, registers and team

These pages are available to the owner.

### Manage stores and registers

1. Open **Stores** to create or edit a location. Enter its name and unique store code.
2. Open **POS registers** to create or manage named stations for a store. Each store starts with a Main register.
3. Employees must be assigned to an active store and, for POS work, an active register in that store. Owners can access all active stores and registers.
4. Use the sidebar selectors to change the current store or register.

Deactivation retains historical records. A store or register with an open shift cannot be deactivated; other safeguards prevent removing the last active store/register or leaving employees without an active store.

### Invite a new employee

1. Open **Team** and find **Invite a new employee**.
2. Enter the employee's email, choose a role, and select the active stores and relevant POS registers.
3. Send the invitation. Email delivery must be configured by the administrator.
4. The employee opens the emailed link, provides their name and a password of at least 12 characters, and creates the account. The single-use link expires after 72 hours.
5. The employee signs in using the invited email and their chosen password.

On **Team**, the owner can also grant access to an existing account whose email is verified (otherwise send an invitation), update employee roles and assignments, or remove organization access. Removing access does not delete the person's account. If an invitation expires or fails, ask the owner to issue another invitation and check email configuration.

## 4. Products and stock

### Add and maintain products

Owners, managers and inventory managers can:

1. Open **Products** and enter the product name and unique SKU.
2. Enter the selling price, optional barcode and unit cost, select an optional category, then set the opening stock and reorder point for the selected store. Owners can add or rename categories under **Settings → Item categories**; products may remain uncategorized.
3. Choose the correct **Tax treatment** and select **Add product**.
4. Edit product details when needed. Add named variants, such as sizes or colours, with their own SKUs, barcodes, prices and stock; reusable option attributes can be managed on the Products page.
5. Archive a product that should no longer be sold, or restore it later. Archiving preserves history.

An unused variant can be deleted only if it has no stock, reservations or relevant history, and at least one variant must remain on the product.

### Import or export the catalog

- Download the CSV template on **Products**, complete it, and use **Import CSV**. Each file can contain up to 50 new products and be no larger than 1 MB. All rows must pass validation; the import creates new products and does not update existing ones. Category names in imports create categories if they do not already exist.
- Use the catalog CSV export to download active or archived products. Exported stock belongs to the selected store.

### Manage inventory

Open **Inventory** and confirm the selected store. Search by product, SKU, barcode or category; use the low-stock and out-of-stock filters when required.

Authorized inventory staff can:

- Record stock adjustments with a reason.
- Enter a physical count and reconcile it against the displayed quantity. If stock changed since the form was opened, refresh the data and recount before retrying.
- Record a damaged-stock write-off.
- Transfer available stock to another active store.
- Set a reorder point and review inventory movement history.

Stock reserved by held sales is not available for other sales, transfers or write-offs. A held sale releases its reservation on checkout or when an authorized user voids it.

## 5. Customers and suppliers

### Customers

Open **Customers** to add or edit a customer, search the directory, or deactivate/reactivate a record. Owners, managers, cashiers and customer-support staff can manage customers. Open a customer's history to review their sales and loyalty activity. Deactivation retains history.

Select a customer in POS before completing a sale if the purchase should be associated with that customer and their loyalty account. Otherwise use **Walk-in customer**.

### Suppliers

Owners, managers and inventory managers can use **Suppliers** to add, edit, search, deactivate or reactivate supplier records. Add an active supplier before creating a purchase order.

## 6. Purchasing

1. Check the selected store and open **Purchasing**.
2. Select an active supplier. Optionally enter an expected delivery date.
3. Add each product, quantity and unit cost; add notes if needed. Review the estimate and select **Create purchase order**.
4. When goods arrive, open the order and record the quantities actually received. Partial receipts are supported and update inventory.
5. Use the order's available actions to record follow-ups, supplier returns or eligible cancellation. A physical return and a supplier-issued credit note are separate records.
6. An owner, manager or accountant can record supplier invoices, payments and actual supplier-issued credit notes on the purchase order. Check the outstanding balance and reconciliation before settling.

Search and filters help locate open, overdue and follow-up-due orders and invoice reminders. A purchase order may be cancelled only when its receipt state permits it.

## 7. Selling at the point of sale

### Open a shift

1. Select the correct store and assigned register in the sidebar.
2. Open **Register shifts**, enter the **Opening cash float** and an optional note, then select **Open register shift**.
3. Open **Point of sale**. An open shift on the selected register is required for register operations.

### Create and complete a sale

1. On **Point of sale**, search for a product by name, SKU or barcode and select it. A keyboard-wedge scanner can enter a uniquely matching barcode in the search field and press Enter.
2. Adjust quantities or remove items. For tracked products, check the available quantity. Optionally select a customer and enter a sale note.
3. If applicable, enter a valid promotion code, authorized manual discount, or customer loyalty points. These discount options cannot be combined. If a gift card is being used, enter its full code.
4. Review the subtotal, discount, tax and total. Select **Save as held cart**. The server validates the cart and reserves tracked stock. Saving also applies the entered gift card up to the amount available.
5. Once the cart is saved, check the gift-card amount and cash remaining, enter **Cash received**, and select **Complete sale**. Checkout revalidates the sale and records payment. Wait for confirmation before taking the next action.
6. Select **Open sale receipt** to view or print it. To share it, ask for the customer's phone number and permission, choose **Prepare receipt link**, then open SMS or WhatsApp and confirm sending the prepared message. The phone number is optional. Anyone with the link can view the receipt for 30 days; don't forward it to others. Sending is done in your device's messaging app and is not confirmed by Keta Retail.

The receipt link must use a publicly reachable HTTPS `AUTH_URL` for customers outside the local network. Local HTTP is only for test data and test passwords, not real customer data. Automated SMS, WhatsApp and mobile-money integrations are not yet available.

Only recorded cash and stored-value gift cards are supported as settlement in this version. Card terminals, mobile-money providers and online payments are not integrated. Do not record an external payment as cash unless your business has an appropriate separate process.

### Hold or resume a cart

Select **Save as held cart** to retain the sale and reserve tracked stock. Resume a held sale from Point of sale on the same store/register shift, make any changes and select **Update held cart** before checkout. An owner or manager can void a held sale to release its reservation.

If the connection drops, unsynced cart lines may be stored in that browser on that device. Reconnect and use **Sync local cart as held cart** or **Sync local cart changes** before checkout. A local cart does not reserve stock, and payment cannot be completed offline. If the held sale changed on the server, follow the conflict message to discard the local changes and reload the latest version; check the cart carefully afterward.

### Close a shift

1. Return to **Register shifts** for the selected register.
2. Count the cash in the drawer and enter **Closing cash counted**, with an optional note.
3. Select **Close register shift** and review the recorded variance.

Expected cash is the opening float plus completed cash sales, less cash refunds recorded during that shift. Gift-card value is not cash in the drawer.

## 8. Refunds and returns

Owners and managers can open **Point of sale** transaction history, find the completed sale, and:

- Choose **Issue cash refund**, enter the allowed amount and a reason, then record the refund.
- Choose **Return sale items**, enter the quantity and reason, and select **Restock** only for items that should return to saleable inventory. Then select **Return items and refund**.

Refunds and returns cannot exceed the remaining eligible value or quantity. Gift-card-funded portions are restored to the original gift card; only cash-funded portions affect register cash. An open shift and the appropriate register permissions are required. Follow your business's own approval and customer-service procedures.

## 9. Promotions, loyalty and gift cards

### Promotions

Owners and managers can open **Promotions** and create a named code with a percentage or fixed discount. Optional settings include eligible products, minimum spend, dates and maximum redemptions. If products are selected, the discount and minimum spend apply to eligible lines. Codes are checked again at checkout and can be activated or deactivated.

### Loyalty

When a customer is selected for a completed sale, loyalty earns **1 point for each full GHS 1 paid**. **100 points = GHS 1** when redeemed. Select the customer in POS and enter the points to redeem; redemption cannot be combined with a promotion or manual discount.

Refunds and returns reverse points proportionally; a balance can become negative, preventing further redemption until it recovers. Points do not expire and are not cash.

### Gift cards

1. An owner or manager opens **Gift cards** and selects **Issue a gift card**.
2. Enter the starting value and optional expiry date, then select **Issue gift card**.
3. Securely give the full code to the recipient. **The complete code is shown only once**; the management list later shows only the last four characters.
4. At POS, enter the full code and save the held cart to apply the available balance. Complete the sale with cash for any remainder.

Cards remain usable through their expiry date in the business timezone; expired cards cannot be reactivated. Search by the last four characters, review activity, deactivate/reactivate eligible cards, or export balances and activity from the Gift cards page. Treat a full gift-card code like cash.

## 10. Tax settings

Owners and managers configure **VAT**, **NHIL** and **GETFund** rates and their effective date under **Settings → Tax setup**. Review **Rate history** after saving. New rates default to zero until configured. Item category management in Settings remains owner-only.

Set each product's tax treatment on **Products**. Only **Standard** products receive the configured tax components; **Zero-rated**, **Exempt** and **Relieved** products receive zero tax in the application. Components are calculated separately on the same post-discount taxable base and saved with the sale.

These settings and exports are operational tools, **not tax advice or a guarantee of compliance**. Confirm rates, effective dates and product classifications with your accountant and current [Ghana Revenue Authority guidance](https://gra.gov.gh/domestic-tax/tax-types/vat/) before using them for real sales or filings.

## 11. Reports, notifications and audit history

### Reports

Open **Reports**, confirm the store, and select a 7-, 30- or 90-day period. Reports include sales trends, refunds, product performance, payment methods, supplier performance and repeat-customer summaries. Available exports include sales trends, sales/refunds and tax snapshots. Owners, managers and accountants can access financial exports and supplier invoice aging, including invoice detail.

Exports are operational summaries, not a general ledger or tax return. Refund tax allocation is not inferred in the tax export. Review source receipts and obtain professional advice before relying on them for accounting or filing.

### Notifications

Open **Notifications** to review available low-stock reminders, supplier follow-ups, invoice reminders and daily sales summaries for your role and assigned stores. Select **Open** to visit the relevant page or **Mark as read** to clear the unread indicator.

An administrator must configure the external daily scheduler for notifications to be generated, and SMTP for email delivery. In-app notifications and email availability depend on that setup; the app does not send SMS or WhatsApp messages.

### Audit history

The owner can open **Audit history** to search and filter recorded actions, inspect details and download a filtered CSV. Audit history supplements, but does not replace, your business's security and backup procedures.

## 12. Daily checklist

**Before opening**

1. Sign in using your own account; select the correct store and register.
2. Review stock and notifications; open the register shift with the counted cash float.
3. Check current prices and, with an authorized manager, the configured tax settings.

**During the day**

1. Save each cart, review the total and complete the sale before issuing a receipt.
2. Receive goods against the correct purchase order; record authorized adjustments, refunds and returns with reasons.
3. Keep gift-card codes and customer information private.

**At closing**

1. Review held sales, transactions and discrepancies with the manager.
2. Count the drawer, close the shift and investigate any variance.
3. Review reports as appropriate, sign out, and follow your organization's backup and handover procedures.

## 13. Troubleshooting

| Symptom | What to check |
|---|---|
| Phone cannot open the app | Use the laptop's current Wi-Fi IP, not `localhost`; check the port, same-network connectivity, app availability and firewall. |
| Registration form reports an error | Read the displayed message, check required fields and password length, and retry. If it says the email already exists, try signing in or ask an administrator for help. |
| After registration I see the sign-in page | This is expected after a successful registration. Look for the account-ready message and sign in. |
| Registration or login opens the dashboard | The browser may already have an active workspace session. Sign out before using another account. |
| Invitation or reset email does not arrive | Check spam and ask the administrator to verify SMTP delivery. Reset requests do not reveal whether the account exists. |
| Store, register or action is unavailable | Check that it is active and assigned to your account, and that your role permits the action. Ask the owner to update access. |
| Sale cannot be completed | Check your selected register, open shift, network connection, stock, cart synchronization, discounts, gift-card balance and the displayed error. |
| Stock is unavailable even though units are on hand | Some stock may be reserved by held carts. Ask an owner or manager to review and, if appropriate, void the held sale. |
| Notifications are missing | Check your role and store access; ask the administrator whether the daily scheduler is running and SMTP is configured for email. |
| Page fails or database is unavailable | Contact the person managing the application. They should check the app, database, network and health endpoint. Do not repeatedly submit payments while the outcome is uncertain; check transaction history first. |

## 14. Current limitations and safety

- The application is still under development. Confirm workflows with test data before relying on it in production.
- Platform administrators manage trials, paid-plan activation and package entitlements. An expired plan remains read-only; contact the platform administrator to renew access or enable a feature. Existing businesses without an assigned subscription retain their current unrestricted access.
- Offline payment completion is disabled. Local unsynced cart data is device/browser-specific and is not a server reservation or completed sale.
- Multi-factor authentication is not implemented. Email addresses are verified through the link sent at registration (request another at `/verify-email`) or by accepting an invitation; owners can only grant direct access to accounts with a verified email.
- SMTP, the notification scheduler, HTTPS, secure hosting and backup/restore arrangements require administrator setup. Hardware integrations and external payment providers are not included.
- Avoid shared accounts, protect passwords and gift-card codes, restrict access to exported files, and arrange regular protected backups with tested restores.

For administrator setup, deployment and backup instructions, see [README.md](README.md). For the implementation roadmap and status, see [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md).
