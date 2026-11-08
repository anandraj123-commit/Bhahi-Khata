"use client";
import { useState, useImperativeHandle, type Ref } from "react";
import Link from "next/link";
import {
  Activity,
  Users,
  Wallet,
  Banknote,
  ArrowDownLeft,
  ArrowUpRight,
  CircleCheck,
  Undo2,
  UserRoundCheck,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";
import {
  useAdminQuery,
  useDebounced,
} from "../../../hooks/admin/use-admin-query";
import { money } from "../../../lib/admin/api";
import { Button, Empty, ErrorState, Skeleton } from "../shared/ui";

const cards = [
  { key: "recent", title: "Recent Transactions", icon: Activity, count: true },
  {
    key: "outstanding",
    title: "Customers with Outstanding Dues",
    icon: UserRoundCheck,
    count: true,
  },
  { key: "udhari", title: "Total Udhari", icon: ArrowUpRight },
  { key: "received", title: "Total Money Received", icon: ArrowDownLeft },
  { key: "recovered", title: "Udhari Recovered", icon: CircleCheck },
  { key: "availableAdvance", title: "Available Advances", icon: Wallet },
  { key: "deposited", title: "Advance Deposited", icon: Banknote },
  { key: "refunded", title: "Advance Refunded", icon: Undo2 },
  { key: "customers", title: "Customers", icon: Users, count: true },
] as const;
type View = (typeof cards)[number]["key"];
type Row = Record<string, string | number | boolean | null>;
type Overview = {
  shop: { id: string; name: string };
  totals: Record<string, number>;
};
type Records = {
  shop: Overview["shop"];
  rows: Row[];
  total: number;
  amount: number;
  page: number;
  limit: number;
};
type Filters = Record<string, string>;
type Column = {
  key: string;
  title: string;
  money?: boolean;
  timestamp?: boolean;
};
const contact: Column[] = [
  { key: "name", title: "Customer Name" },
  { key: "phone", title: "Mobile Number" },
  { key: "address", title: "Address" },
];
const stamps: Column[] = [
  { key: "createdAt", title: "Created At (UTC)", timestamp: true },
  { key: "updatedAt", title: "Updated At (UTC)", timestamp: true },
];
const financial = (key: string, title: string): Column => ({
  key,
  title,
  money: true,
});
function columns(view: View): Column[] {
  const customer = ["customers", "outstanding", "availableAdvance"].includes(
    view,
  );
  if (customer)
    return [
      { key: "customerId", title: "Customer ID" },
      ...contact,
      ...(view === "availableAdvance"
        ? [
            financial("deposited", "Total Advance Deposited"),
            financial("used", "Advance Used / Adjusted"),
            financial("refunded", "Advance Refunded"),
            financial("availableAdvance", "Available Advance Balance"),
            { key: "lastAdvanceActivity", title: "Last Advance Activity" },
          ]
        : [
            financial("udhari", "Total Udhari"),
            financial("received", "Total Money Received"),
            financial("outstanding", "Outstanding Amount"),
            ...(view === "customers"
              ? [financial("availableAdvance", "Available Advance")]
              : []),
            { key: "lastTransaction", title: "Last Transaction Date" },
          ]),
      { key: "customerStatus", title: "Customer Status" },
      ...stamps,
    ];
  return [
    { key: "clientId", title: "Transaction ID / Opening Record" },
    ...contact,
    { key: "type", title: "Transaction / Receipt Type" },
    financial(
      "amount",
      view === "recovered"
        ? "Recovered Amount"
        : view === "deposited"
          ? "Deposited Amount"
          : view === "refunded"
            ? "Refunded Amount"
            : view === "udhari"
              ? "Udhari Amount"
              : "Amount",
    ),
    ...(view === "recent"
      ? [
          financial("previousBalance", "Previous Net Balance (calculated)"),
          financial("balance", "Updated Net Balance (calculated)"),
          financial("recovered", "Udhari Recovered"),
          financial("deposited", "Advance Deposited"),
          financial("used", "Advance Adjustment"),
        ]
      : view === "recovered"
        ? [
            financial(
              "previousOutstanding",
              "Previous Outstanding (calculated)",
            ),
            financial(
              "remainingOutstanding",
              "Remaining Outstanding (calculated)",
            ),
          ]
        : []),
    {
      key: "method",
      title: view === "refunded" ? "Refund Method" : "Payment Method",
    },
    { key: "date", title: "Transaction Date" },
    { key: "note", title: "Description / Notes" },
    { key: "transactionStatus", title: "Record Status" },
    ...stamps,
  ];
}
function presetRange(preset: string) {
  const now = new Date();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(end);
  if (preset === "yesterday") {
    start.setUTCDate(start.getUTCDate() - 1);
    end.setUTCDate(end.getUTCDate() - 1);
  }
  if (preset === "7" || preset === "30")
    start.setUTCDate(start.getUTCDate() - Number(preset) + 1);
  if (preset === "month") start.setUTCDate(1);
  if (preset === "lastMonth") {
    start.setUTCMonth(start.getUTCMonth() - 1, 1);
    end.setUTCDate(0);
  }
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
  };
}
function timestamp(value: Row[string]) {
  if (
    !value ||
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value))
  )
    return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
export function ShopFinancialOverview({
  shopId,
  overviewRef,
}: {
  shopId: string;
  overviewRef?: Ref<{ showOverview: () => void }>;
}) {
  const overview = useAdminQuery<Overview>(
    `shops/${shopId}/financial-overview`,
  );
  const [view, setView] = useState<View | null>(null);
  useImperativeHandle(
    overviewRef,
    () => ({ showOverview: () => setView(null) }),
    [],
  );
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const serialized = JSON.stringify(filters);
  const debounced = useDebounced(serialized, 300);
  const params = new URLSearchParams({
    ...JSON.parse(debounced),
    view: view || "recent",
    page: String(page),
    limit: String(limit),
  });
  const details = useAdminQuery<Records>(
    `shops/${shopId}/financial-records?${params}`,
    !!view && serialized === debounced,
  );
  const customerView =
    !!view && ["customers", "outstanding", "availableAdvance"].includes(view);
  const data = details.data?.data;
  const totals = overview.data?.data?.totals;
  const card = cards.find((c) => c.key === view);
  const pages = Math.max(1, Math.ceil((data?.total || 0) / limit));
  const waiting = serialized !== debounced;
  function change(key: string, value: string) {
    setFilters((old) => {
      const next = { ...old };
      if (value.trim()) next[key] = value;
      else delete next[key];
      return next;
    });
    setPage(1);
  }
  function open(next: View, customerId?: string) {
    setView(next);
    setPage(1);
    setFilters({
      sort: ["customers", "outstanding", "availableAdvance"].includes(next)
        ? "name"
        : "date",
      direction: ["customers", "outstanding", "availableAdvance"].includes(next)
        ? "asc"
        : "desc",
      ...(customerId ? { exactCustomerId: customerId } : {}),
    });
  }
  function input(key: string, title: string, type = "text") {
    return (
      <label className="a-filter" key={key}>
        <span>{title}</span>
        <input
          className="a-input"
          type={type}
          min={type === "number" ? "0" : undefined}
          step={type === "number" ? "0.01" : undefined}
          value={filters[key] || ""}
          onChange={(e) => change(key, e.target.value)}
        />
      </label>
    );
  }
  function select(key: string, title: string, options: [string, string][]) {
    return (
      <label className="a-filter" key={key}>
        <span>{title}</span>
        <select
          className="a-select"
          value={filters[key] || ""}
          onChange={(e) => change(key, e.target.value)}
        >
          <option value="">All / default</option>
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function refresh() {
    void overview.refetch();
    if (view) void details.refetch();
  }
  const allColumns = view ? columns(view) : [];
  return (
    <section
      className="a-card a-shop-financial"
      aria-label="Shop Financial Overview"
      style={{ marginTop: 0, marginBottom: 24 }}
    >
      <div className="a-card-head">
        <div>
          <h2>Shop Financial Overview</h2>
          <p className="a-definition">
            Synchronized customer ledger · INR · timestamps and date presets in
            UTC
          </p>
        </div>
        <Button
          variant="outline"
          busy={overview.isFetching || (!!view && details.isFetching)}
          onClick={refresh}
        >
          <RefreshCw size={15} />
          Refresh
        </Button>
      </div>
      <div className="a-card-body">
        {overview.isError && (
          <ErrorState
            message={overview.error.message}
            retry={() => void overview.refetch()}
          />
        )}
        {!view ? (
          <>
            <div className="a-financial-grid">
              {cards.map(({ key, title, icon: Icon, ...rest }) => (
                <button
                  key={key}
                  className="a-financial-card"
                  onClick={() => open(key)}
                >
                  <Icon size={20} aria-hidden />
                  <span>{title}</span>
                  <strong>
                    {overview.isPending
                      ? "Loading…"
                      : overview.isError || totals?.[key] == null
                        ? "Unavailable"
                        : "count" in rest
                          ? totals[key].toLocaleString("en-IN")
                          : money(totals[key])}
                  </strong>
                </button>
              ))}
            </div>
            {overview.isSuccess && totals?.customers === 0 && (
              <Empty
                title="No synchronized customer records"
                message="This shop’s customer and financial records will appear after synchronization."
              />
            )}
            <p className="a-definition">
              Financial totals include all non-deleted customer records,
              including disabled, removed and subscription-archived profiles, as
              in the Home financial totals. Customers here counts all such
              profiles; the mobile Home customer count shows active profiles
              only. Device-only changes are not available until synchronized.
            </p>
          </>
        ) : null}
        {view && (
          <>
            <div className="a-financial-heading">
              <Button variant="outline" onClick={() => setView(null)}>
                <ArrowLeft size={15} />
                Back to Overview
              </Button>
              <h3>{card?.title}</h3>
            </div>
            <p>
              {overview.data?.data.shop.name || data?.shop.name} · Shop ID:{" "}
              <code>{shopId}</code>
              {filters.exactCustomerId && (
                <>
                  {" "}
                  · Customer ID: <code>{filters.exactCustomerId}</code>
                </>
              )}
            </p>
            <p className="a-definition">
              Shop-wide {card && "count" in card ? "count" : "total"}:{" "}
              {overview.isPending
                ? "Loading…"
                : overview.isError || totals?.[view] == null
                  ? "Unavailable"
                  : card && "count" in card
                    ? totals[view].toLocaleString("en-IN")
                    : money(totals[view])}
              . Filters below affect matching records only. Opening balances are
              explicitly labeled source records, not fabricated transactions.
              Net balances are calculated from ledger chronology; negative means
              advance.
            </p>
            <div className="a-financial-filters">
              {input("q", "Search name, mobile, address or ID")}
              {input("name", "Customer Name")}
              {input("phone", "Mobile Number")}
              {input("address", "Address")}
              {input("customerId", "Customer ID")}
              {select("customerStatus", "Customer Status", [
                ["active", "Active"],
                ["disabled", "Disabled"],
                ["removed", "Removed"],
                ["invalid", "Unavailable / inconsistent"],
              ])}
              {select("archived", "Subscription restriction", [
                ["true", "Archived"],
                ["false", "Not archived"],
              ])}
              {!customerView && (
                <>
                  {input("clientId", "Transaction ID")}
                  {input("method", "Payment / Refund Method")}
                  {select("type", "Transaction Type", [
                    ["credit", "Udhari"],
                    ["payment", "Payment received"],
                    ["refund", "Advance refund"],
                    ["opening", "Opening balance"],
                  ])}
                  {select("transactionStatus", "Transaction Status", [
                    ["recorded", "Recorded"],
                    ["conflict_resolved", "Conflict resolved"],
                    ["opening", "Opening balance"],
                  ])}
                  {input("amountMin", "Minimum contribution (₹)", "number")}
                  {input("amountMax", "Maximum contribution (₹)", "number")}
                </>
              )}
              {customerView && (
                <>
                  {select("outstandingPositive", "Outstanding balance", [
                    ["true", "Greater than zero"],
                  ])}
                  {input("outstandingMin", "Minimum outstanding (₹)", "number")}
                  {input("outstandingMax", "Maximum outstanding (₹)", "number")}
                  {select("availableAdvancePositive", "Available advance", [
                    ["true", "Greater than zero"],
                  ])}
                  {input(
                    "availableAdvanceMin",
                    "Minimum advance (₹)",
                    "number",
                  )}
                  {input(
                    "availableAdvanceMax",
                    "Maximum advance (₹)",
                    "number",
                  )}
                </>
              )}
              <label className="a-filter">
                <span>
                  {customerView
                    ? "Last transaction date preset (UTC)"
                    : "Transaction date preset (UTC)"}
                </span>
                <select
                  className="a-select"
                  value=""
                  onChange={(e) => {
                    if (e.target.value && e.target.value !== "custom") {
                      setFilters((old) => ({
                        ...old,
                        ...presetRange(e.target.value),
                      }));
                      setPage(1);
                    }
                  }}
                >
                  <option value="">Select / custom range</option>
                  {[
                    ["today", "Today"],
                    ["yesterday", "Yesterday"],
                    ["7", "Last 7 Days"],
                    ["30", "Last 30 Days"],
                    ["month", "This Month"],
                    ["lastMonth", "Last Month"],
                    ["custom", "Custom Date Range"],
                  ].map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {input(
                "dateFrom",
                customerView
                  ? "Last transaction from"
                  : "Transaction date from",
                "date",
              )}
              {input(
                "dateTo",
                customerView ? "Last transaction to" : "Transaction date to",
                "date",
              )}
              {input("createdAtFrom", "Created At from (UTC)", "date")}
              {input("createdAtTo", "Created At to (UTC)", "date")}
              {input("updatedAtFrom", "Updated At from (UTC)", "date")}
              {input("updatedAtTo", "Updated At to (UTC)", "date")}
              {select("sort", "Sort by", [
                ["name", "Customer Name"],
                ...(customerView
                  ? ([
                      ["outstanding", "Outstanding Amount"],
                      ["availableAdvance", "Available Advance"],
                    ] as [string, string][])
                  : ([["amount", "Contribution Amount"]] as [
                      string,
                      string,
                    ][])),
                ["date", "Transaction Date"],
                ["createdAt", "Created At"],
                ["updatedAt", "Updated At"],
              ])}
              {select("direction", "Sort direction", [
                ["asc", "Ascending"],
                ["desc", "Descending"],
              ])}
              <Button variant="outline" onClick={() => open(view)}>
                Clear All Filters
              </Button>
            </div>
            {details.isPending || waiting ? (
              <Skeleton />
            ) : details.isError ? (
              <ErrorState
                message={details.error.message}
                retry={() => void details.refetch()}
              />
            ) : (
              data && (
                <>
                  <p aria-live="polite">
                    {data.total.toLocaleString("en-IN")} matching records ·
                    Filtered{" "}
                    {customerView
                      ? view === "availableAdvance"
                        ? "available advance"
                        : "outstanding balance"
                      : view === "recent"
                        ? "gross transaction amount (not net cash flow)"
                        : "contribution"}
                    : <strong>{money(data.amount)}</strong>
                  </p>
                  {data.rows.length ? (
                    <div className="a-table-wrap">
                      <table className="a-table">
                        <thead>
                          <tr>
                            {allColumns.map((c) => (
                              <th key={c.key}>{c.title}</th>
                            ))}
                            <th>Customer details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.rows.map((row) => (
                            <tr key={`${row.customerId}:${row.clientId}`}>
                              {allColumns.map((c) => {
                                const value =
                                  c.key === "previousOutstanding"
                                    ? row.previousBalance == null
                                      ? null
                                      : Math.max(0, Number(row.previousBalance))
                                    : c.key === "remainingOutstanding"
                                      ? row.balance == null
                                        ? null
                                        : Math.max(0, Number(row.balance))
                                      : row[c.key];
                                return (
                                  <td key={c.key}>
                                    {c.key === "name" ? (
                                      <button
                                        className="a-financial-link"
                                        onClick={() =>
                                          open("recent", String(row.customerId))
                                        }
                                      >
                                        {String(value || "Unnamed customer")}
                                      </button>
                                    ) : c.timestamp ? (
                                      timestamp(value)
                                    ) : c.money ? (
                                      value == null ? (
                                        "Unavailable"
                                      ) : (
                                        money(Number(value))
                                      )
                                    ) : c.key === "customerStatus" ? (
                                      `${String(value || "Unavailable")}${row.archived ? " · subscription archived" : ""}`
                                    ) : c.key === "type" ? (
                                      {
                                        credit: "Udhari",
                                        payment: "Payment received",
                                        refund: "Advance refund",
                                        opening: "Opening balance",
                                      }[String(value)] || String(value)
                                    ) : value == null || value === "" ? (
                                      "Unavailable"
                                    ) : (
                                      String(value)
                                    )}
                                  </td>
                                );
                              })}
                              <td>
                                <Link
                                  href={`/admin/customers/${row.customerMongoId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Existing customer details ↗
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty />
                  )}
                  <div className="a-pagination">
                    <span>
                      Showing {data.rows.length ? (page - 1) * limit + 1 : 0}–
                      {data.rows.length
                        ? Math.min(page * limit, data.total)
                        : 0}{" "}
                      of {data.total.toLocaleString("en-IN")} · Page {page} of{" "}
                      {pages}
                    </span>
                    <div className="a-pagination-controls">
                      <label>
                        Page size{" "}
                        <select
                          className="a-select"
                          value={limit}
                          onChange={(e) => {
                            setLimit(Number(e.target.value));
                            setPage(1);
                          }}
                        >
                          {[20, 50, 100].map((n) => (
                            <option key={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <Button
                        variant="outline"
                        disabled={page <= 1 || details.isFetching}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        Previous Page
                      </Button>
                      {Array.from(
                        new Set([
                          1,
                          ...Array.from(
                            { length: 5 },
                            (_, i) => page + i - 2,
                          ).filter((n) => n > 0 && n <= pages),
                          pages,
                        ]),
                      )
                        .sort((a, b) => a - b)
                        .map((n) => (
                          <Button
                            variant={n === page ? "default" : "outline"}
                            key={n}
                            aria-label={`Page ${n}`}
                            aria-current={n === page ? "page" : undefined}
                            disabled={details.isFetching}
                            onClick={() => setPage(n)}
                          >
                            {n}
                          </Button>
                        ))}
                      <Button
                        variant="outline"
                        disabled={page >= pages || details.isFetching}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next Page
                      </Button>
                    </div>
                  </div>
                </>
              )
            )}
          </>
        )}
      </div>
    </section>
  );
}
