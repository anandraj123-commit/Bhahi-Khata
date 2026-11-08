"use client";
import Link from "next/link";
import { OpeningBalanceSummary } from "./opening-balance-summary";
import {
  TransactionFilters,
  validateTransactionRanges,
} from "../filters/transaction-filters";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeftRight, RefreshCw, Eye, ReceiptText } from "lucide-react";
import {
  useAdminQuery,
  useDebounced,
} from "../../../hooks/admin/use-admin-query";
import { money, AdminApiError } from "../../../lib/admin/api";
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Modal,
  Skeleton,
} from "../shared/ui";

type Row = {
  _id: string;
  clientId: string;
  shopId: string;
  shop: { name: string; owner?: string; phone?: string; address?: string };
  customerMongoId: string;
  customerId: string;
  name: string;
  phone?: string;
  address?: string;
  customerStatus: string;
  archived: boolean;
  type: string;
  amountPaise: number;
  date: string;
  createdAt?: string;
  updatedAt?: string;
  recordedAt?: string;
  method?: string;
  note?: string;
  reference?: string;
  serverVersion?: number;
  resolutionVersion?: number;
  transactionStatus: string;
  previousBalance: number;
  balance: number;
  recovered: number;
  deposited: number;
  used: number;
};
type Totals = Record<string, number>;
type Result = {
  rows: Row[];
  summary: Totals;
  opening: Totals | null;
  page: number;
  limit: number;
};
type Detail = {
  transaction: Row;
  currentCustomer: {
    outstandingPaise: number;
    availableAdvancePaise: number;
    totalUdhariPaise: number;
    totalReceivedPaise: number;
    customer: { createdAt?: string; updatedAt?: string };
  };
};
const metrics = [
  ["total", "Total Transactions"],
  ["udhari", "Total Udhari"],
  ["received", "Total Money Received"],
  ["recovered", "Udhari Recovered"],
  ["deposited", "Advance Deposited"],
  ["refunded", "Advance Refunded"],
  ["used", "Advance Used"],
] as const;
const typeName = (v: string) =>
  ({
    credit: "Udhari / Credit",
    payment: "Payment Received",
    refund: "Advance Refund",
  })[v] || v;
const stamp = (v?: string) =>
  v && Number.isFinite(Date.parse(v))
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(v))
    : "—";
const show = (v: unknown) =>
  v === undefined || v === null || v === "" ? "—" : String(v);
function errorMessage(error: Error) {
  if (error instanceof AdminApiError)
    return (
      {
        0: "Unable to connect to server.",
        401: "Your session has expired. Sign in again.",
        403: "Access denied. Financial record permission is required.",
        404: "Endpoint or record unavailable. Confirm the backend deployment.",
        503: "The administration service is unavailable.",
      }[error.status] || error.message
    );
  return error.message;
}
function TransactionDetail({ id, close }: { id: string; close: () => void }) {
  const query = useAdminQuery<Detail>(`transactions/${id}`);
  const r = query.data?.data.transaction,
    c = query.data?.data.currentCustomer;
  const pairs = (values: [string, unknown][]) => (
    <dl className="a-ledger-details">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{show(value)}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <Modal
      title="Transaction Details"
      description="Read-only customer ledger record. Timestamps are UTC."
      open
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      {query.isPending ? (
        <Skeleton />
      ) : query.error ? (
        <ErrorState
          message={errorMessage(query.error)}
          retry={() => void query.refetch()}
        />
      ) : (
        r &&
        c && (
          <>
            <h3>Transaction information</h3>
            {pairs([
              ["Transaction ID", r.clientId],
              ["Database ID", r._id],
              ["Type", typeName(r.type)],
              ["Amount (INR)", money(r.amountPaise)],
              ["Business date", r.date],
              ["Method", r.method],
              ["Notes", r.note],
              ["Status", r.transactionStatus],
              ["Created At", stamp(r.createdAt)],
              ["Updated At", stamp(r.updatedAt)],
            ])}
            <h3>Shop</h3>
            {pairs([
              ["Name", r.shop.name],
              ["Shop ID", r.shopId],
              ["Owner", r.shop.owner],
              ["Mobile", r.shop.phone],
              ["Address", r.shop.address],
            ])}
            <Button asChild variant="outline">
              <Link href={`/admin/shops/${r.shopId}`}>View Shop</Link>
            </Button>
            <h3>Customer · current values</h3>
            {pairs([
              ["Name", r.name],
              ["Customer ID", r.customerId],
              ["Mobile", r.phone],
              ["Address", r.address],
              ["Status", r.customerStatus],
              ["Subscription archived", r.archived ? "Yes" : "No"],
              ["Outstanding", money(c.outstandingPaise)],
              ["Available advance", money(c.availableAdvancePaise)],
              ["Total Udhari", money(c.totalUdhariPaise)],
              ["Total Money Received", money(c.totalReceivedPaise)],
              ["Created At", stamp(c.customer.createdAt)],
              ["Updated At", stamp(c.customer.updatedAt)],
            ])}
            <Button asChild variant="outline">
              <Link href={`/admin/customers/${r.customerMongoId}`}>
                View Customer & Ledger
              </Link>
            </Button>
            <h3>Reconstructed ledger allocation</h3>
            <p className="a-muted">
              Calculated from the current ledger chronology, not stored
              historical balance snapshots. Later edits may change these
              allocations.
            </p>
            {pairs([
              ["Previous outstanding", money(Math.max(0, r.previousBalance))],
              ["Updated outstanding", money(Math.max(0, r.balance))],
              [
                "Outstanding change",
                money(Math.max(0, r.balance) - Math.max(0, r.previousBalance)),
              ],
              ["Previous advance", money(Math.max(0, -r.previousBalance))],
              ["Updated advance", money(Math.max(0, -r.balance))],
              [
                "Advance change",
                money(
                  Math.max(0, -r.balance) - Math.max(0, -r.previousBalance),
                ),
              ],
              ["Udhari recovered", money(r.recovered)],
              ["Advance deposited", money(r.deposited)],
              ["Advance used", money(r.used)],
            ])}
            <h3>Available audit information</h3>
            {pairs([
              ["Recorded At", stamp(r.recordedAt)],
              ["Reference", r.reference],
              ["Server version", r.serverVersion],
              ["Resolution version", r.resolutionVersion],
            ])}
            <p className="a-muted">
              Online/offline source, actor identity and reversal links are not
              recorded by this ledger model.
            </p>
          </>
        )
      )}
    </Modal>
  );
}
export function Transactions() {
  const search = useSearchParams(),
    pathname = usePathname();
  const url = search.toString();
  const [draft, setDraft] = useState(url);
  useEffect(() => setDraft(url), [url]);
  const debounced = useDebounced(draft, 350);
  const errors = validateTransactionRanges(new URLSearchParams(draft));
  const valid =
    errors.length === 0 &&
    validateTransactionRanges(new URLSearchParams(debounced)).length === 0;
  useEffect(() => {
    if (valid && debounced === draft && debounced !== url)
      window.history.replaceState(
        null,
        "",
        pathname + (debounced ? "?" + debounced : ""),
      );
  }, [debounced, draft, valid, url, pathname]);
  const f = new URLSearchParams(draft);
  const set = (key: string, value: string) =>
    setDraft((old) => {
      const p = new URLSearchParams(old);
      if (value.trim()) p.set(key, value);
      else p.delete(key);
      if (key !== "page") p.delete("page");
      return p.toString();
    });
  const query = useAdminQuery<Result>(
    "transactions" + (debounced ? "?" + debounced : ""),
    valid,
  );
  const data = query.data?.data;
  const [selected, setSelected] = useState<string | null>(null);
  const page = Number(f.get("page") || 1),
    limit = Number(f.get("limit") || 20),
    total = data?.summary.total || 0,
    pages = Math.max(1, Math.ceil(total / limit));
  const busy = valid && (query.isFetching || draft !== debounced);
  const sort = (key: string) => {
    setDraft((old) => {
      const p = new URLSearchParams(old);
      p.set(
        "direction",
        p.get("sort") === key && p.get("direction") !== "asc" ? "asc" : "desc",
      );
      p.set("sort", key);
      p.delete("page");
      return p.toString();
    });
  };
  const th = (key: string, label: string) => (
    <th
      aria-sort={
        (f.get("sort") || "date") === key
          ? f.get("direction") === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button onClick={() => sort(key)}>
        {label}{" "}
        {(f.get("sort") || "date") === key
          ? f.get("direction") === "asc"
            ? "↑"
            : "↓"
          : "↕"}
      </button>
    </th>
  );
  const active = [...f.entries()].filter(
    ([k]) => !["page", "limit", "sort", "direction"].includes(k),
  );
  return (
    <div className="a-ledger-page">
      <header className="a-page-heading">
        <div>
          <h1>
            <ArrowLeftRight size={26} /> Transactions
          </h1>
          <p>
            View and manage transaction visibility across all registered shops.
          </p>
          <p className="a-muted">
            Read-only · customer ledgers · dates and timestamps in UTC
          </p>
        </div>
        <Button
          variant="outline"
          busy={busy}
          disabled={!valid}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={16} />
          Refresh
        </Button>
      </header>
      {query.error && (
        <ErrorState
          message={errorMessage(query.error)}
          retry={valid ? () => void query.refetch() : undefined}
        />
      )}
      <p className="a-muted" aria-live="polite">
        {!valid
          ? "Filters need correction before results can update."
          : busy
            ? "Updating results…"
            : query.error
              ? "Refresh failed. Any retained values below are from the previous successful response."
              : query.dataUpdatedAt
                ? `Last retrieved ${stamp(new Date(query.dataUpdatedAt).toISOString())}`
                : "Loading transactions…"}
      </p>
      <div className="a-ledger-metrics">
        {metrics.map(([key, label]) => (
          <section className="a-card a-kpi" key={key}>
            <div className="a-kpi-top">
              <span>{label}</span>
              <ReceiptText size={18} />
            </div>
            {query.isPending && valid ? (
              <Skeleton rows={1} />
            ) : (
              <strong>
                {data
                  ? key === "total"
                    ? data.summary[key].toLocaleString("en-IN")
                    : money(data.summary[key])
                  : "—"}
              </strong>
            )}
            <small>Matching ledger transactions</small>
          </section>
        ))}
      </div>
      <p className="a-muted">
        Amounts are allocations from matching transactions, excluding opening
        balances. Advance Used is credit settled from prepaid balances, not
        additional cash received. No debit/credit grand total is summed.
      </p>
      {data && (
        <OpeningBalanceSummary
          values={data.opening}
          scoped={[
            "shopId",
            "shopName",
            "shopPhone",
            "name",
            "phone",
            "address",
            "customerId",
            "customerStatus",
            "archived",
          ].some((key) => new URLSearchParams(debounced).has(key))}
          updating={busy}
          stale={!valid || Boolean(query.error)}
        />
      )}
      <TransactionFilters value={draft} onChange={setDraft} errors={errors} />
      <section className="a-card" aria-busy={busy}>
        {query.isPending && valid ? (
          <Skeleton rows={8} />
        ) : (
          data && (
            <>
              <div className="a-table-wrap">
                <table className="a-table a-ledger-table">
                  <thead>
                    <tr>
                      <th>Transaction ID</th>
                      {th("shop.name", "Shop Name")}
                      <th>Shop ID</th>
                      {th("name", "Customer Name")}
                      <th>Customer Mobile</th>
                      <th>Customer Address</th>
                      {th("type", "Transaction Type")}
                      {th("amountPaise", "Amount")}
                      <th>Payment Method</th>
                      {th("date", "Transaction Date")}
                      <th>Notes</th>
                      {th("createdAt", "Created At")}
                      {th("updatedAt", "Updated At")}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r._id}>
                        <td>
                          <code>{r.clientId}</code>
                        </td>
                        <td>
                          <Link href={`/admin/shops/${r.shopId}`}>
                            {r.shop.name || "Registered shop"}
                          </Link>
                        </td>
                        <td>
                          <code>{r.shopId}</code>
                        </td>
                        <td>
                          <Link href={`/admin/customers/${r.customerMongoId}`}>
                            {r.name || "Customer"}
                          </Link>
                        </td>
                        <td>{show(r.phone)}</td>
                        <td>{show(r.address)}</td>
                        <td>
                          <Badge>{typeName(r.type)}</Badge>
                        </td>
                        <td className="a-ledger-money">
                          {money(r.amountPaise)}
                        </td>
                        <td>{show(r.method)}</td>
                        <td>{r.date}</td>
                        <td>{show(r.note)}</td>
                        <td>{stamp(r.createdAt)}</td>
                        <td>{stamp(r.updatedAt)}</td>
                        <td>
                          <Button
                            variant="ghost"
                            onClick={() => setSelected(r._id)}
                            aria-label={`View transaction ${r.clientId}`}
                          >
                            <Eye size={16} />
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.rows.length && !query.error && (
                <Empty
                  title={
                    active.length
                      ? "No matching transactions"
                      : "No transactions found"
                  }
                  message="Only live customer ledger records are shown. Opening balances and Cashfree payments are not transaction rows."
                />
              )}
              <div className="a-pagination">
                <span>
                  {total
                    ? `Showing ${Math.min((page - 1) * limit + 1, total)}–${Math.min(page * limit, total)} of ${total.toLocaleString("en-IN")}`
                    : "0 records"}{" "}
                  · Page {page} of {pages}
                </span>
                <div className="a-pagination-controls">
                  <label>
                    Rows{" "}
                    <select
                      value={limit}
                      onChange={(e) => set("limit", e.target.value)}
                    >
                      {[20, 50, 100].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="outline"
                    disabled={page <= 1 || busy}
                    onClick={() => set("page", String(page - 1))}
                  >
                    Previous
                  </Button>
                  {Array.from(
                    { length: Math.min(5, pages) },
                    (_, i) => Math.max(1, Math.min(page - 2, pages - 4)) + i,
                  ).map((n) => (
                    <Button
                      key={n}
                      variant={n === page ? "default" : "ghost"}
                      disabled={busy}
                      aria-current={n === page ? "page" : undefined}
                      onClick={() => set("page", String(n))}
                    >
                      {n}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    disabled={page >= pages || busy}
                    onClick={() => set("page", String(page + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )
        )}
      </section>
      {selected && (
        <TransactionDetail id={selected} close={() => setSelected(null)} />
      )}
    </div>
  );
}
