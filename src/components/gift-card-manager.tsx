"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { issueGiftCard, setGiftCardActive } from "@/app/gift-cards/actions";

type GiftCard = {
  id: string;
  codeLastFour: string;
  initialBalance: string;
  balance: string;
  active: boolean;
  expiresOn: string | null;
  expired: boolean;
  createdAt: string;
  hasMoreTransactions: boolean;
  transactions: GiftCardTransaction[];
};

type GiftCardTransaction = {
  id: string;
  type: "ISSUE" | "REDEEM" | "REFUND";
  amountDelta: string;
  createdBy: string;
  recordedAt: string;
  orderNumber: number | null;
};

const initialState = { status: "idle" as const, message: "" };

function GiftCardStatusForm({ card }: { card: GiftCard }) {
  const [state, action, pending] = useActionState(setGiftCardActive, initialState);
  return (
    <form action={action} className="gift-card-status-form">
      <input type="hidden" name="giftCardId" value={card.id} />
      <input type="hidden" name="active" value={String(!card.active)} />
      <button className="button-quiet" type="submit" disabled={pending || (!card.active && card.expired)}>
        {pending ? "Saving..." : card.active ? "Deactivate" : "Activate"}
      </button>
      {!card.active && card.expired && <small>Expired cards cannot be reactivated.</small>}
      {state.message && <small role={state.status === "error" ? "alert" : "status"}>{state.message}</small>}
    </form>
  );
}

export function GiftCardManager({
  cards,
  currency,
  businessDate,
  page,
  pageCount,
  rangeStart,
  rangeEnd,
  totalCount,
  query,
  statusFilter,
}: {
  cards: GiftCard[];
  currency: string;
  businessDate: string;
  page: number;
  pageCount: number;
  rangeStart: number;
  rangeEnd: number;
  totalCount: number;
  query: string;
  statusFilter: string;
}) {
  const [state, action, pending] = useActionState(issueGiftCard, initialState);
  const [copyMessage, setCopyMessage] = useState("");

  function pageHref(target: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (statusFilter) params.set("status", statusFilter);
    params.set("page", String(target));
    return `/gift-cards?${params.toString()}`;
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopyMessage("Gift card code copied.");
    } catch (error) {
      console.error("Gift card code could not be copied.", error);
      setCopyMessage("Copy was unavailable. Select and copy the code manually.");
    }
  }

  return (
    <div className="gift-card-manager">
      <section className="form-panel gift-card-issue-panel">
        <div className="panel-title-row"><div><h2>Issue a gift card</h2><p>The full code is shown only once. Save it securely and give it to the recipient.</p></div></div>
        <form action={action} className="gift-card-issue-form">
          <label>Starting value ({currency})<input name="amount" type="number" min="0.01" max="9999999999.99" step="0.01" required /></label>
          <label>Expiry date <span className="optional-label">Optional</span><input name="expiresOn" type="date" min={businessDate} /></label>
          {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
          {state.code && <div className="gift-card-issued-code"><strong>{state.code}</strong><button className="button-quiet" type="button" onClick={() => copyCode(state.code ?? "")}>Copy code</button>{copyMessage && <small role="status">{copyMessage}</small>}</div>}
          <button className="button-primary" type="submit" disabled={pending}>{pending ? "Issuing..." : "Issue gift card"}</button>
        </form>
      </section>

      <section className="data-panel gift-card-list-panel">
        <div className="panel-title-row">
          <div><h2>Gift cards</h2><p>Balances and status for cards issued by this business.</p></div>
          <div className="inventory-table-actions">
            <a className="report-export-link" href="/gift-cards/transactions/export">Download activity CSV</a>
            <a className="report-export-link" href="/gift-cards/export">Download balances CSV</a>
            <span className="table-count">{totalCount.toLocaleString("en-GH")} {query || statusFilter ? "matching" : "total"}</span>
          </div>
        </div>
        <form className="search-form purchase-order-filters" action="/gift-cards" method="get" role="search">
          <label className="visually-hidden" htmlFor="gift-card-search">Search by the last four gift card code characters</label>
          <input id="gift-card-search" name="q" type="search" defaultValue={query} placeholder="Search last four code characters" maxLength={4} />
          <label className="visually-hidden" htmlFor="gift-card-status">Filter gift cards by status</label>
          <select id="gift-card-status" name="status" defaultValue={statusFilter}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="expired">Expired</option>
          </select>
          <button className="button-quiet" type="submit">Search</button>
          {(query || statusFilter) && <Link className="clear-search" href="/gift-cards">Clear</Link>}
        </form>
        <div className="table-scroll"><table>
          <thead><tr><th>Code</th><th>Balance</th><th>Original value</th><th>Expiry</th><th>Status</th><th>Recent activity</th><th>Action</th></tr></thead>
          <tbody>
            {cards.map((card) => (
              <tr key={card.id}>
                <td>•••• {card.codeLastFour}</td>
                <td>{currency} {Number(card.balance).toFixed(2)}</td>
                <td>{currency} {Number(card.initialBalance).toFixed(2)}</td>
                <td>{card.expiresOn ?? "No expiry"}</td>
                <td>{!card.active ? "Inactive" : card.expiresOn && card.expiresOn < businessDate ? "Expired" : "Active"}</td>
                <td>
                  <details className="gift-card-history">
                    <summary>{card.hasMoreTransactions ? "Latest 5 (older activity available)" : `History (${card.transactions.length})`}</summary>
                    <ul>
                      {card.transactions.map((transaction) => (
                        <li key={transaction.id}>
                          <span>
                            <strong>{transaction.type === "ISSUE" ? "Issued" : transaction.type === "REDEEM" ? "Redeemed" : "Refunded"}</strong>
                            <small>{transaction.createdBy} · {transaction.recordedAt}{transaction.orderNumber ? ` · Sale #${transaction.orderNumber}` : ""}</small>
                          </span>
                          <strong>{Number(transaction.amountDelta) > 0 ? "+" : "−"}{currency} {Math.abs(Number(transaction.amountDelta)).toFixed(2)}</strong>
                        </li>
                      ))}
                    </ul>
                    {card.hasMoreTransactions && (
                      <Link className="clear-search" href={`/gift-cards/${card.id}`}>View complete history</Link>
                    )}
                    {card.transactions.length === 0 && <small>No recorded activity.</small>}
                  </details>
                </td>
                <td><GiftCardStatusForm card={card} /></td>
              </tr>
            ))}
            {cards.length === 0 && (
              <tr><td colSpan={7} className="report-empty">
                {query || statusFilter ? "No gift cards match those filters." : "No gift cards issued yet."}
              </td></tr>
            )}
          </tbody>
        </table></div>
        {totalCount > 0 && (
          <nav className="customer-directory-pagination" aria-label="Gift card pages">
            <span>Showing {rangeStart}–{rangeEnd} of {totalCount.toLocaleString("en-GH")} {query || statusFilter ? "matching " : ""}gift cards</span>
            <div>
              {page > 1
                ? <Link className="button-quiet" href={pageHref(page - 1)}>Previous</Link>
                : <span className="button-quiet pagination-disabled">Previous</span>}
              <span>Page {page} of {pageCount}</span>
              {page < pageCount
                ? <Link className="button-quiet" href={pageHref(page + 1)}>Next</Link>
                : <span className="button-quiet pagination-disabled">Next</span>}
            </div>
          </nav>
        )}
      </section>
    </div>
  );
}
