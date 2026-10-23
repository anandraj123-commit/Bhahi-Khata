"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Search, UserRound, Eye } from "lucide-react";
import type {
  AdminCustomer,
  CustomerShop,
  CustomerSummary,
} from "../../../types/admin";
import { useAdminQuery, useDebounced } from "../../../hooks/admin/use-admin-query";
import { date, money } from "../../../lib/admin/api";
import { Badge, Button, Empty, ErrorState, Modal, Skeleton } from "../shared/ui";
import { DateFilter } from "../shared/date-filter";
import { useAdmin } from "../layout/shell";
import type { Envelope, Pagination } from "../../../types/admin";

function Status({ value }: { value: AdminCustomer["status"] }) {
  const label = value === "invalid" ? "Needs review" : value;
  return <Badge tone={value === "invalid" ? "expired" : value}>{label}</Badge>;
}

function CustomerTable({
  rows,
  compact = false,
}: {
  rows: AdminCustomer[];
  compact?: boolean;
}) {
  return (
    <div className="a-table-wrap">
      <table className="a-table">
        <thead>
          <tr>
            <th scope="col">Customer name</th>
            {!compact && <th scope="col">Shop name</th>}
            <th scope="col">Customer ID</th>
            <th scope="col">Status</th>
            <th scope="col">Created</th>
            {!compact && <th scope="col">Last updated</th>}
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((customer) => (
            <tr key={customer._id}>
              <td>{customer.name || "Unnamed customer"}</td>
              {!compact && (
                <td>
                  <Link href={`/admin/shops/${customer.shopId}`}>
                    {customer.shopName || "Registered shop"}
                  </Link>
                </td>
              )}
              <td><code>{customer.customerId || customer._id}</code></td>
              <td><Status value={customer.status} /></td>
              <td>{date(customer.createdAt)}</td>
              {!compact && <td>{date(customer.updatedAt)}</td>}
              <td>
                <Link href={`/admin/customers/${customer._id}`}>View</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCards({ summary }: { summary?: CustomerSummary }) {
  const values = [
    ["Total customers", summary?.total],
    ["Active", summary?.active],
    ["Disabled", summary?.disabled],
    ["Removed", summary?.removed],
  ] as const;
  return (
    <div className="a-kpis" aria-label="Customer totals">
      {values.map(([label, value]) => (
        <article className="a-card a-kpi" key={label}>
          <div className="a-kpi-top"><span>{label}</span><span className="a-kpi-icon"><UserRound size={17} /></span></div>
          <strong>{value === undefined ? "—" : value.toLocaleString()}</strong>
          <small>{value === undefined ? "Loading authorized totals" : "Linked registered shops"}</small>
        </article>
      ))}
    </div>
  );
}

export function CustomerManagement() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [shopSearch, setShopSearch] = useState("");
  const shopQueryText = useDebounced(shopSearch);
  const [shopId, setShopId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({ from: "", to: "" });
  const shopOptions = useAdminQuery<CustomerShop[]>(
    `customer-shops?${new URLSearchParams({ q: shopQueryText, limit: "50" })}`,
  );
  const params = new URLSearchParams({
    page: String(page),
    limit: "20",
    sort: "newest",
    ...(q ? { q } : {}),
    ...(shopId ? { shopId } : {}),
    ...(status ? { status } : {}),
    ...Object.fromEntries(Object.entries(range).filter(([, value]) => value)),
  });
  const query = useAdminQuery<AdminCustomer[]>(`customers?${params}`);
  const waiting = q !== search;
  const response = query.data as (typeof query.data & { summary?: CustomerSummary }) | undefined;
  const summary = response?.summary;
  const total = query.data?.pagination?.total || 0;
  const pages = query.data?.pagination?.pages || Math.max(1, Math.ceil(total / 20));
  return (
    <>
      <div className="a-page-heading">
        <div>
          <div className="a-eyebrow">PLATFORM DIRECTORY</div>
          <h1>Customers</h1>
          <p>Read-only customer profiles associated with registered shops.</p>
        </div>
        <Badge>Read-only</Badge>
      </div>
      <SummaryCards summary={summary} />
      <section className="a-card" aria-label="Customer records">
        <div className="a-toolbar">
          <div className="a-search">
            <Search aria-hidden="true" />
            <input
              className="a-input"
              aria-label="Search customers"
              placeholder="Search name, customer ID or shop…"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            />
          </div>
          <div className="a-filter">
            <label htmlFor="customer-shop-search">Find shop</label>
            <input
              id="customer-shop-search"
              className="a-input"
              placeholder="Search shop names"
              value={shopSearch}
              onChange={(event) => setShopSearch(event.target.value)}
            />
          </div>
          <div className="a-filter">
            <label htmlFor="customer-shop">Shop</label>
            <select
              id="customer-shop"
              className="a-select"
              value={shopId}
              onChange={(event) => { setShopId(event.target.value); setPage(1); }}
              disabled={shopOptions.isError}
            >
              <option value="">All shops</option>
              {(shopOptions.data?.data || []).map((shop) => (
                <option key={shop.id} value={shop.id}>{shop.name}</option>
              ))}
            </select>
          </div>
          <div className="a-filter">
            <label htmlFor="customer-status">Lifecycle</label>
            <select
              id="customer-status"
              className="a-select"
              value={status}
              onChange={(event) => { setStatus(event.target.value); setPage(1); }}
            >
              <option value="">All customers</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
              <option value="removed">Removed</option>
            </select>
          </div>
          <DateFilter
            {...range}
            onChange={(from, to) => { setRange({ from, to }); setPage(1); }}
          />
          <Button
            variant="ghost"
            aria-label="Refresh customers"
            busy={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={16} />
          </Button>
        </div>
        {shopOptions.isError && (
          <ErrorState message="Shop filters could not be loaded." retry={() => void shopOptions.refetch()} />
        )}
        {query.isFetching && !query.isPending && <div role="status" aria-label="Refreshing customers" className="a-loading-line" />}
        {query.isPending || waiting ? (
          <Skeleton />
        ) : query.isError ? (
          <ErrorState message={query.error.message} retry={() => void query.refetch()} />
        ) : !query.data?.data.length ? (
          <Empty title="No customers found" message="No registered-shop customers match these filters." />
        ) : (
          <CustomerTable rows={query.data.data} />
        )}
        <div className="a-pagination">
          <span>{query.isPending || waiting ? "Loading customers…" : `${total.toLocaleString()} records · Page ${page} of ${pages}`}</span>
          <div className="a-pagination-controls">
            <Button variant="outline" aria-label="Previous page" disabled={page <= 1 || query.isFetching || waiting} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={15} />Previous</Button>
            <Button variant="outline" aria-label="Next page" disabled={page >= pages || query.isFetching || waiting} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight size={15} /></Button>
          </div>
        </div>
      </section>
    </>
  );
}

export function CustomerDetail({ id }: { id: string }) {
  const session = useAdmin();
  const query = useAdminQuery<AdminCustomer>(`customers/${id}`);
  const customer = query.data?.data;
  const canReadFinancial = session.permissions.includes("customers:financial:read");
  const canReadTransactions = session.permissions.includes("customers:transactions:read");
  const canReadStatement = session.permissions.includes("customers:statement:read");
  const initialRange = () => {
    const now = new Date();
    const from = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
    return { from, to };
  };
  const [range, setRange] = useState(initialRange);
  const [transactionRange, setTransactionRange] = useState({ from: "", to: "" });
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [selected, setSelected] = useState<FinancialTransaction | null>(null);
  const financialQuery = useAdminQuery<CustomerFinancial>(`customers/${id}/financial-summary`, canReadFinancial);
  const statementParams = new URLSearchParams(range);
  const statementQuery = useAdminQuery<CustomerStatement>(`customers/${id}/statement?${statementParams}`, canReadStatement && Boolean(range.from && range.to));
  const transactionParams = new URLSearchParams({ page: String(page), limit: "20", sort, ...(type ? { type } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}), ...Object.fromEntries(Object.entries(transactionRange).filter(([, value]) => value)) });
  const transactionQuery = useAdminQuery<FinancialTransaction[]>(`customers/${id}/transactions?${transactionParams}`, canReadTransactions);
  const transactionData = transactionQuery.data as Envelope<FinancialTransaction[]> & { openingEntries?: OpeningTransaction[] } | undefined;
  const pageInfo = transactionQuery.data?.pagination as Pagination | undefined;
  return (
    <>
      <div className="a-page-heading">
        <div><div className="a-eyebrow">CUSTOMER DIRECTORY</div><h1>{customer?.name || "Customer details"}</h1><p>Customer account and read-only ledger information.</p></div>
        <Button asChild variant="outline"><Link href="/admin/customers">All customers</Link></Button>
      </div>
      {query.isPending ? <Skeleton /> : query.isError ? <ErrorState message={query.error.message} retry={() => void query.refetch()} /> : customer ? (
        <section className="a-card">
          <div className="a-card-head"><h2>Customer profile</h2><Status value={customer.status} /></div>
          <dl className="a-card-body a-detail-grid">
            <div><dt>Customer name</dt><dd>{customer.name || "Unnamed customer"}</dd></div>
            <div><dt>Customer ID</dt><dd><code>{customer.customerId || customer._id}</code></dd></div>
            <div><dt>Shop</dt><dd><Link href={`/admin/shops/${customer.shopId}`}>{customer.shopName}</Link></dd></div>
            <div><dt>Lifecycle status</dt><dd><Status value={customer.status} /></dd></div>
            <div><dt>Created</dt><dd>{date(customer.createdAt)}</dd></div>
            <div><dt>Last updated</dt><dd>{date(customer.updatedAt)}</dd></div>
            {canReadFinancial && <div><dt>Last ledger activity</dt><dd>{date(financialQuery.data?.data.customer.lastActivityAt)}</dd></div>}
          </dl>
        </section>
      ) : <Empty title="Customer not found" />}
      {canReadFinancial && <section className="a-card" style={{ marginTop: 24 }}>
        <div className="a-card-head"><div><h2>Financial overview</h2><p className="a-definition">Authoritative ledger totals, calculated using Digital-Khata’s existing balance rules.</p></div></div>
        {financialQuery.isPending ? <Skeleton rows={2} /> : financialQuery.isError ? <ErrorState message={financialQuery.error.message} retry={() => void financialQuery.refetch()} /> : financialQuery.data && <div className="a-kpis">
          {([
            ["Current outstanding", financialQuery.data.data.outstandingPaise],
            ["Available advance", financialQuery.data.data.availableAdvancePaise],
            ["Total Udhari", financialQuery.data.data.totalUdhariPaise],
            ["Total money received", financialQuery.data.data.totalReceivedPaise],
            ["Udhari recovered", financialQuery.data.data.totalUdhariRecoveredPaise],
            ["Advance deposited", financialQuery.data.data.totalAdvanceDepositedPaise],
            ["Advance refunded", financialQuery.data.data.totalAdvanceRefundedPaise],
          ] as const).map(([label, value]) => <article className="a-card a-kpi" key={label}><div className="a-kpi-top"><span>{label}</span></div><strong>{money(value)}</strong><small>All-time ledger total</small></article>)}
        </div>}
      </section>}
      {canReadStatement && <section className="a-card" style={{ marginTop: 24 }}>
        <div className="a-card-head"><div><h2>Statement</h2><p className="a-definition">Opening and closing balances use the same period rules as the mobile ledger.</p></div></div>
        <div className="a-toolbar"><DateFilter {...range} onChange={(from, to) => { setRange({ from, to }); setPage(1); }} /></div>
        {statementQuery.isPending ? <Skeleton rows={2} /> : statementQuery.isError ? <ErrorState message={statementQuery.error.message} retry={() => void statementQuery.refetch()} /> : statementQuery.data && <>
          <div className="a-kpis">
            <MoneyCard label="Opening balance" value={statementQuery.data.data.openingBalancePaise} />
            <MoneyCard label="Closing balance" value={statementQuery.data.data.closingBalancePaise} />
            <MoneyCard label="Transactions" value={statementQuery.data.data.transactionCount} count />
            <MoneyCard label="Udhari in period" value={statementQuery.data.data.totalUdhariPaise} />
            <MoneyCard label="Money received" value={statementQuery.data.data.totalMoneyReceivedPaise} />
            <MoneyCard label="Advance refunded" value={statementQuery.data.data.totalAdvanceRefundedPaise} />
          </div>
          <p className="a-definition" style={{ padding: "0 20px 18px" }}>Period: {date(`${range.from}T00:00:00Z`)} – {date(`${range.to}T00:00:00Z`)}. Debit and credit totals are not separate concepts in the stored ledger schema.</p>
        </>}
      </section>}
      {canReadTransactions && <section className="a-card" style={{ marginTop: 24 }}>
        <div className="a-card-head"><div><h2>Transaction history</h2><p className="a-definition">Opening balance entries are shown separately; voided entries remain visible but do not affect totals.</p></div></div>
        <div className="a-toolbar">
          <div className="a-search"><Search aria-hidden="true" /><input className="a-input" aria-label="Search transaction reference" placeholder="Search transaction reference…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
          <label className="a-filter">Type<select className="a-select" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}><option value="">All types</option><option value="credit">Udhari given</option><option value="payment">Payment received</option><option value="refund">Advance refunded</option><option value="opening">Opening entries</option></select></label>
          <label className="a-filter">Record status<select className="a-select" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All records</option><option value="recorded">Recorded</option><option value="conflict_resolved">Conflict resolved</option><option value="voided">Voided</option></select></label>
          <label className="a-filter">Sort<select className="a-select" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
          <DateFilter {...transactionRange} onChange={(from, to) => { setTransactionRange({ from, to }); setPage(1); }} />
        </div>
        {transactionQuery.isPending ? <Skeleton /> : transactionQuery.isError ? <ErrorState message={transactionQuery.error.message} retry={() => void transactionQuery.refetch()} /> : !transactionData?.data.length && !transactionData?.openingEntries?.length ? <Empty title="No transactions found" message="No ledger entries match this period and filter." /> : <>
          {!!transactionData?.openingEntries?.length && <div className="a-table-wrap"><table className="a-table"><thead><tr><th>Opening record</th><th>Date</th><th>Amount</th><th>Effect</th><th>Status</th></tr></thead><tbody>{transactionData.openingEntries.map((entry) => <tr key={entry.id}><td>{entry.label}</td><td>{date(`${entry.date}T00:00:00Z`)}</td><td>{money(entry.amountPaise)}</td><td>{entry.balanceEffectPaise > 0 ? "+" : entry.balanceEffectPaise < 0 ? "−" : "—"}{money(Math.abs(entry.balanceEffectPaise))}</td><td><Badge>Opening record</Badge></td></tr>)}</tbody></table></div>}
          {!!transactionData?.data.length && <div className="a-table-wrap"><table className="a-table"><thead><tr><th>Transaction</th><th>Date</th><th>Type</th><th>Amount</th><th>Balance effect</th><th>Status</th><th>Details</th></tr></thead><tbody>{transactionData.data.map((entry) => <tr key={entry.id}><td><code>{entry.id}</code></td><td>{date(entry.recordedAt || `${entry.date}T00:00:00Z`)}<small>{entry.date}</small></td><td>{transactionLabel(entry.type)}</td><td>{money(entry.amountPaise)}</td><td>{entry.balanceEffectPaise === null ? "—" : `${entry.balanceEffectPaise > 0 ? "+" : "−"}${money(Math.abs(entry.balanceEffectPaise))}`}</td><td><Badge tone={entry.status === "voided" ? "disabled" : entry.status === "conflict_resolved" ? "expired" : "active"}>{entry.status.replaceAll("_", " ")}</Badge></td><td><Button variant="ghost" aria-label={`View transaction ${entry.id}`} onClick={() => setSelected(entry)}><Eye size={16} />View</Button></td></tr>)}</tbody></table></div>}
          <div className="a-pagination"><span>{(pageInfo?.total || 0).toLocaleString()} ledger records · Page {page} of {Math.max(1, pageInfo?.pages || 1)}</span><div className="a-pagination-controls"><Button variant="outline" disabled={page <= 1 || transactionQuery.isFetching} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={15} />Previous</Button><Button variant="outline" disabled={page >= (pageInfo?.pages || 1) || transactionQuery.isFetching} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight size={15} /></Button></div></div>
        </>}
      </section>}
      {!canReadFinancial && <Empty title="Financial overview unavailable" message="Your administrator role does not permit access to customer financial information." />}
      <Modal title="Transaction details" description="Read-only information from the customer ledger." open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        {selected && <dl className="a-detail-grid" style={{ marginTop: 20 }}>
          <div><dt>Transaction ID</dt><dd><code>{selected.id}</code></dd></div><div><dt>Type</dt><dd>{transactionLabel(selected.type)}</dd></div><div><dt>Amount</dt><dd>{money(selected.amountPaise)}</dd></div><div><dt>Transaction date</dt><dd>{date(`${selected.date}T00:00:00Z`)}</dd></div><div><dt>Created</dt><dd>{date(selected.createdAt)}</dd></div><div><dt>Last updated</dt><dd>{date(selected.updatedAt)}</dd></div><div><dt>Status</dt><dd>{selected.status.replaceAll("_", " ")}</dd></div><div><dt>Method</dt><dd>{selected.method || "—"}</dd></div><div><dt>Reference</dt><dd>{selected.reference || "—"}</dd></div><div><dt>Note</dt><dd>{selected.note || "—"}</dd></div>
        </dl>}
      </Modal>
    </>
  );
}

type CustomerFinancial = {
  customer: { lastActivityAt?: string | null };
  outstandingPaise: number; availableAdvancePaise: number; totalUdhariPaise: number;
  totalReceivedPaise: number; totalUdhariRecoveredPaise: number;
  totalAdvanceDepositedPaise: number; totalAdvanceRefundedPaise: number;
};
type CustomerStatement = {
  openingBalancePaise: number; closingBalancePaise: number; transactionCount: number;
  totalUdhariPaise: number; totalMoneyReceivedPaise: number; totalAdvanceRefundedPaise: number;
};
type FinancialTransaction = {
  id: string; type: "credit" | "payment" | "refund"; amountPaise: number;
  balanceEffectPaise: number | null; date: string; recordedAt: string | null;
  note: string; method: string; reference: string; status: string;
  createdAt: string | null; updatedAt: string | null;
};
type OpeningTransaction = { id: string; label: string; amountPaise: number; balanceEffectPaise: number; date: string };
function MoneyCard({ label, value, count = false }: { label: string; value: number; count?: boolean }) {
  return <article className="a-card a-kpi"><div className="a-kpi-top"><span>{label}</span></div><strong>{count ? value.toLocaleString() : money(value)}</strong></article>;
}
function transactionLabel(type: FinancialTransaction["type"]) {
  return type === "credit" ? "Udhari given" : type === "payment" ? "Payment received" : "Advance refunded";
}

export function ShopCustomers({ shopId }: { shopId: string }) {
  const [page, setPage] = useState(1);
  const query = useAdminQuery<AdminCustomer[]>(`shops/${shopId}/customers?page=${page}&limit=10&sort=newest`);
  const response = query.data as (typeof query.data & { summary?: CustomerSummary }) | undefined;
  const summary = response?.summary;
  const total = query.data?.pagination?.total || 0;
  const pages = query.data?.pagination?.pages || Math.max(1, Math.ceil(total / 10));
  return (
    <section className="a-card" style={{ marginTop: 24 }}>
      <div className="a-card-head"><div><h2>Customers</h2><p className="a-definition">Customer profiles for this shop only.</p></div></div>
      {query.isPending ? <Skeleton rows={3} /> : query.isError ? <ErrorState message={query.error.message} retry={() => void query.refetch()} /> : (
        <>
          <div className="a-kpis">
            {([["Total", summary?.total], ["Active", summary?.active], ["Disabled", summary?.disabled], ["Removed", summary?.removed]] as const).map(([label, count]) => (
              <article className="a-card a-kpi" key={label}><div className="a-kpi-top"><span>{label}</span></div><strong>{count?.toLocaleString() ?? "—"}</strong></article>
            ))}
          </div>
          {!query.data?.data.length ? <Empty title="No customers for this shop" /> : <CustomerTable rows={query.data.data} compact />}
          <div className="a-pagination"><span>{total.toLocaleString()} customers · Page {page} of {pages}</span><div className="a-pagination-controls"><Button variant="outline" disabled={page <= 1 || query.isFetching} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={15} />Previous</Button><Button variant="outline" disabled={page >= pages || query.isFetching} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight size={15} /></Button></div></div>
        </>
      )}
    </section>
  );
}
