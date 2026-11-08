"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ReceiptText,
  RefreshCw,
  Eye,
  Copy,
  Filter,
  ChevronLeft,
} from "lucide-react";
import {
  useAdminQuery,
  useDebounced,
} from "../../../hooks/admin/use-admin-query";
import { money } from "../../../lib/admin/api";
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Modal,
  Skeleton,
} from "../shared/ui";
import { PaymentOrderLink } from "../shared/payment-order-link";
import { FilterSelect, ShopSelect } from "../filters/transaction-filters";
import { useAdmin } from "../layout/shell";
type Row = Record<string, unknown>;
type PageInfo = { page: number; limit: number; total: number; pages?: number };
type Summary = {
  _id: string;
  total: number;
  paid: number;
  pending: number;
  failed: number;
  expired: number;
  attention: number;
  verifiedPaidMinor: number;
  multipleAttempts: number;
};
const text = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : String(v);
const object = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
const stamp = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v))
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(v))
    : "—";
const amount = (v: unknown, c: unknown = "INR") =>
  typeof v === "number" && Number.isFinite(v)
    ? money(v, typeof c === "string" ? c : "INR")
    : "—";
const localStatuses = [
  "created",
  "pending",
  "paid",
  "failed",
  "refunded",
  "partially_refunded",
];
const attemptStatuses = [
  "SUCCESS",
  "FAILED",
  "PENDING",
  "USER_DROPPED",
  "CANCELLED",
  "VOID",
  "NOT_ATTEMPTED",
];
const label = (v: string) => v.replaceAll("_", " ");
const options = (values: string[]) =>
  [["", "All"], ...values.map((v) => [v, label(v)])] as [string, string][];
function CopyId({ value, href }: { value: unknown; href?: string }) {
  const [message, setMessage] = useState("");
  return (
    <span className="a-order-copy">
      {href ? (
        <Link className="a-order-link" href={href}>
          <code>{text(value)}</code>
        </Link>
      ) : (
        <code>{text(value)}</code>
      )}
      {typeof value === "string" && (
        <Button
          variant="ghost"
          aria-label={`Copy ${value}`}
          onClick={() => {
            if (!navigator.clipboard) {
              setMessage("Copy unavailable");
              return;
            }
            void navigator.clipboard.writeText(value).then(
              () => setMessage("Copied"),
              () => setMessage("Copy unavailable"),
            );
          }}
        >
          <Copy size={14} />
        </Button>
      )}
      <span role="status">{message}</span>
    </span>
  );
}
function Pagination({
  info,
  change,
}: {
  info: PageInfo;
  change: (key: string, value: string) => void;
}) {
  const pages = Math.max(1, Math.ceil(info.total / info.limit));
  return (
    <div className="a-pagination">
      <span>
        {info.total
          ? `Showing ${Math.min((info.page - 1) * info.limit + 1, info.total)}–${Math.min(info.page * info.limit, info.total)} of ${info.total}`
          : "0 records"}{" "}
        · Page {info.page} of {pages}
      </span>
      <div className="a-pagination-controls">
        <label>
          Rows{" "}
          <select
            value={info.limit}
            onChange={(e) => change("limit", e.target.value)}
          >
            {[20, 50, 100].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          disabled={info.page <= 1}
          onClick={() => change("page", String(info.page - 1))}
        >
          Previous
        </Button>
        {Array.from(
          { length: Math.min(5, pages) },
          (_, i) => Math.max(1, Math.min(info.page - 2, pages - 4)) + i,
        ).map((n) => (
          <Button
            key={n}
            variant={n === info.page ? "default" : "ghost"}
            aria-current={n === info.page ? "page" : undefined}
            onClick={() => change("page", String(n))}
          >
            {n}
          </Button>
        ))}
        <Button
          variant="outline"
          disabled={info.page >= pages}
          onClick={() => change("page", String(info.page + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
function range(preset: string) {
  const now = new Date(),
    today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  let a = new Date(today),
    b = new Date(today);
  if (preset === "yesterday") {
    a.setUTCDate(a.getUTCDate() - 1);
    b = new Date(a);
  }
  if (preset === "7" || preset === "30")
    a.setUTCDate(a.getUTCDate() - Number(preset) + 1);
  if (preset === "month") a.setUTCDate(1);
  if (preset === "lastMonth") {
    a = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    b = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  }
  return [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)];
}
export function PaymentOrderList() {
  const search = useSearchParams(),
    path = usePathname(),
    url = search.toString();
  const [draft, setDraft] = useState(url),
    [advanced, setAdvanced] = useState(false),
    [preset, setPreset] = useState(""),
    [, setShopLabel] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => setDraft(url), [url]);
  const debounced = useDebounced(draft, 350),
    p = new URLSearchParams(draft);
  const invalid = (v: string) => {
    const f = new URLSearchParams(v),
      a = f.get("amountMin"),
      b = f.get("amountMax");
    return Boolean(
      (f.get("from") && f.get("to") && f.get("from")! > f.get("to")!) ||
      (a !== null && b !== null && Number(a) > Number(b)) ||
      [a, b].some(
        (n) =>
          n !== null &&
          (!Number.isFinite(Number(n)) || Number(n) < 0 || Number(n) > 1e12),
      ),
    );
  };
  const valid = !invalid(draft) && !invalid(debounced);
  useEffect(() => {
    if (valid && draft === debounced && url !== debounced)
      window.history.replaceState(
        null,
        "",
        path + (debounced ? "?" + debounced : ""),
      );
  }, [valid, draft, debounced, url, path]);
  const query = useAdminQuery<Row[]>("payment-orders?" + debounced, valid);
  const response = query.data as unknown as
    { data: Row[]; pagination: PageInfo; summary: Summary[] } | undefined;
  const change = (key: string, value: string) => {
    setDraft((old) => {
      const n = new URLSearchParams(old);
      if (value.trim()) n.set(key, value);
      else n.delete(key);
      if (key !== "page") n.delete("page");
      return n.toString();
    });
  };
  const reset = () => {
    const n = new URLSearchParams();
    for (const k of ["sort", "direction", "limit"])
      if (p.has(k)) n.set(k, p.get(k)!);
    setDraft(n.toString());
    setPreset("");
  };
  const select = (
    key: string,
    title: string,
    values: [string, string][],
    fallback = "",
  ) => (
    <FilterSelect
      label={title}
      value={p.get(key) || fallback}
      options={values}
      onChange={(v) => change(key, v)}
    />
  );
  const input = (key: string, title: string, type = "text") => (
    <label className="a-filter-field">
      <span>{title}</span>
      <input
        type={type}
        value={p.get(key) || ""}
        onChange={(e) => change(key, e.target.value)}
        maxLength={100}
        {...(type === "number" ? { min: 0, max: 1e12, step: 0.01 } : {})}
      />
    </label>
  );
  const chips = [...p.entries()].filter(
    ([k]) => !["page", "limit", "sort", "direction", "dateField"].includes(k),
  );
  const total = (key: keyof Summary) =>
    response?.summary.reduce((n, r) => n + Number(r[key] || 0), 0);
  const href = (id: unknown) =>
    `/admin/payment-orders/${id}${draft ? "?return=" + encodeURIComponent(draft) : ""}`;
  const columns: [string, string][] = [
    ["createdAt", "Created At"],
    ["updatedAt", "Updated At"],
    ["amountMinor", "Order Amount"],
    ["status", "Order Status"],
    ["shopName", "Shop Name"],
    ["latestPaymentTime", "Latest Payment Date"],
    ["checkoutExpiresAt", "Order Expiry"],
  ];
  return (
    <div className="a-order-page">
      <header className="a-page-heading">
        <div>
          <h1>
            <ReceiptText size={26} /> Payment Orders
          </h1>
          <p>
            View payment orders, payment attempts, subscription purchases, and
            reconciliation status across all authorized shops.
          </p>
          <p className="a-muted">
            Read-only stored records · timestamps UTC ·{" "}
            {query.dataUpdatedAt
              ? `Last retrieved ${stamp(new Date(query.dataUpdatedAt).toISOString())}`
              : "Not yet loaded"}
          </p>
        </div>
        <Button
          variant="outline"
          busy={query.isFetching}
          disabled={!valid}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={16} />
          Refresh
        </Button>
      </header>
      {query.error && (
        <ErrorState
          message={query.error.message}
          retry={valid ? () => void query.refetch() : undefined}
        />
      )}
      <div className="a-ledger-metrics">
        {(
          [
            ["total", "Total Payment Orders"],
            ["paid", "Paid Orders"],
            ["pending", "Pending Orders"],
            ["failed", "Failed Orders"],
            ["expired", "Provider Expired Orders"],
            ["attention", "Orders Requiring Attention"],
          ] as const
        ).map(([key, title]) => (
          <section key={key} className="a-card a-kpi">
            <div className="a-kpi-top">{title}</div>
            <strong>
              {response ? total(key)?.toLocaleString("en-IN") : "—"}
            </strong>
            <small>Matching orders · current environment</small>
          </section>
        ))}
        <section className="a-card a-kpi">
          <div className="a-kpi-top">Verified Paid Amount</div>
          {response ? (
            response.summary.length ? (
              response.summary.map((r) => (
                <strong key={r._id}>
                  {amount(r.verifiedPaidMinor, r._id)}
                </strong>
              ))
            ) : (
              <strong>No matching orders</strong>
            )
          ) : (
            <strong>—</strong>
          )}
          <small>
            Gross verified captures; excludes wallet, before refunds. Additional
            captures included once and flagged for review.
          </small>
        </section>
      </div>
      {query.isFetching && <p role="status">Updating records…</p>}
      {query.error && response && (
        <p role="alert">
          Displayed values are from the previous successful response.
        </p>
      )}
      <section className="a-card a-transaction-filters">
        <div className="a-filter-toolbar">
          {input("q", "Search", "search")}
          <ShopSelect
            value={p.get("shopId") || ""}
            onChange={(v) => change("shopId", v)}
            onLabel={setShopLabel}
          />
          {select("status", "Order Status", options(localStatuses))}
          {select(
            "paymentStatus",
            "Latest Provider Attempt",
            options(attemptStatuses),
          )}
          <FilterSelect
            label="Date Range"
            value={preset || (p.has("from") || p.has("to") ? "custom" : "")}
            options={[
              ["", "All Dates"],
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["7", "Last 7 Days"],
              ["30", "Last 30 Days"],
              ["month", "This Month"],
              ["lastMonth", "Last Month"],
              ["custom", "Custom Range"],
            ]}
            onChange={(v) => {
              setPreset(v);
              if (v === "custom") {
                setAdvanced(true);
                return;
              }
              const [from, to] = v ? range(v) : ["", ""];
              setDraft((old) => {
                const n = new URLSearchParams(old);
                for (const [k, val] of [
                  ["from", from],
                  ["to", to],
                ])
                  if (val) n.set(k, val);
                  else n.delete(k);
                n.delete("page");
                return n.toString();
              });
            }}
          />
          <Button
            variant="outline"
            aria-expanded={advanced}
            aria-controls="order-filters"
            onClick={() => setAdvanced(!advanced)}
          >
            <Filter size={16} />
            Advanced ({chips.length})
          </Button>
          <Button variant="ghost" onClick={reset}>
            Reset Filters
          </Button>
        </div>
        <p className="a-muted">
          Search exact local/provider order or payment IDs, or a shop
          name/mobile prefix. Choose a shop to narrow large searches.
        </p>
        {advanced && (
          <div id="order-filters" className="a-filter-groups">
            <fieldset>
              <legend>Status & Operations</legend>
              <div className="a-filter-grid">
                {select(
                  "gatewayStatus",
                  "Provider Order Status",
                  options([
                    "ACTIVE",
                    "PAID",
                    "EXPIRED",
                    "TERMINATED",
                    "TERMINATION_REQUESTED",
                  ]),
                )}
                {select(
                  "reconciliation",
                  "Reconciliation",
                  options(["pending", "error", "checked", "unverified"]),
                )}
                {select(
                  "subscriptionStatus",
                  "Stored Subscription Status",
                  options([
                    "active",
                    "paused",
                    "scheduled",
                    "expired",
                    "cancelled",
                    "missing",
                  ]),
                )}
                {select(
                  "refundStatus",
                  "Verified Refund Status",
                  options([
                    "SUCCESS",
                    "PENDING",
                    "CANCELLED",
                    "ONHOLD",
                    "FAILED",
                  ]),
                )}
                {select(
                  "attempts",
                  "Payment Attempts",
                  options([
                    "none",
                    "multiple",
                    "successful",
                    "failed",
                    "pending",
                  ]),
                )}
                {select("attention", "Attention", [
                  ["", "All orders"],
                  ["true", "Review required"],
                ])}
              </div>
            </fieldset>
            <fieldset>
              <legend>Purchase & Amount</legend>
              <div className="a-filter-grid">
                {input("plan", "Historical Plan Code")}
                {input("durationMonths", "Duration (months)", "number")}
                {input("amountMin", "Minimum Cash Payable (₹)", "number")}
                {input("amountMax", "Maximum Cash Payable (₹)", "number")}
              </div>
            </fieldset>
            <fieldset>
              <legend>Dates · UTC</legend>
              <div className="a-filter-grid">
                {select(
                  "dateField",
                  "Date Field",
                  [
                    ["createdAt", "Created At"],
                    ["updatedAt", "Updated At"],
                    ["checkoutExpiresAt", "Order Expiry"],
                    ["latestPaymentTime", "Latest Attempt Initiated"],
                  ],
                  "createdAt",
                )}
                {input("from", "Start Date", "date")}
                {input("to", "End Date (inclusive)", "date")}
              </div>
            </fieldset>
            <fieldset>
              <legend>Sorting</legend>
              <div className="a-filter-grid">
                {select("sort", "Sort By", columns, "createdAt")}
                {select(
                  "direction",
                  "Direction",
                  [
                    ["desc", "Descending"],
                    ["asc", "Ascending"],
                  ],
                  "desc",
                )}
                {select(
                  "limit",
                  "Page Size",
                  [
                    ["20", "20"],
                    ["50", "50"],
                    ["100", "100"],
                  ],
                  "20",
                )}
              </div>
            </fieldset>
          </div>
        )}
        {chips.length > 0 && (
          <div className="a-filter-chips">
            {chips.map(([k, v]) => (
              <button
                key={k}
                onClick={() => change(k, "")}
                aria-label={`Remove ${k}`}
              >
                {label(k)}: {v} ×
              </button>
            ))}
            <Button variant="ghost" onClick={reset}>
              Clear All Filters
            </Button>
          </div>
        )}
        {!valid && (
          <p role="alert">
            Correct the date or amount range before results can update. Minimums
            cannot exceed maximums or be negative.
          </p>
        )}
      </section>
      {query.isPending && valid ? (
        <Skeleton rows={8} />
      ) : (
        response && (
          <section className="a-card">
            <div className="a-table-wrap">
              <table className="a-table a-order-table">
                <thead>
                  <tr>
                    {[
                      "Payment Order ID",
                      "Cashfree Order ID",
                      "Shop Name",
                      "Shop ID",
                      "Shop Mobile",
                      "Plan",
                      "Duration",
                      "Cash Payable",
                      "Currency",
                      "Order Status",
                      "Provider Order Status",
                      "Latest Payment Status",
                      "Attempt Count",
                      "Verified Paid Amount",
                      "Verification",
                      "Reconciliation",
                      "Subscription Status",
                      "Created At",
                      "Updated At",
                      "Expiry",
                      "Actions",
                    ].map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {response.data.map((r) => (
                    <tr key={text(r._id)}>
                      <td>
                        <CopyId value={r._id} href={href(r._id)} />
                      </td>
                      <td>{text(r.gatewayOrderId)}</td>
                      <td>
                        <Link href={`/admin/shops/${r.shopId}`}>
                          {text(r.shopName)}
                        </Link>
                      </td>
                      <td>{text(r.shopId)}</td>
                      <td>{text(object(r.shop).phone)}</td>
                      <td>
                        {text(
                          object(object(r.pricingSnapshot).plan).name ||
                            r.planCode,
                        )}
                      </td>
                      <td>{text(r.durationMonths)} months</td>
                      <td>{amount(r.amountMinor, r.currency)}</td>
                      <td>{text(r.currency)}</td>
                      <td>
                        <Badge tone={text(r.status)}>{text(r.status)}</Badge>
                      </td>
                      <td>{text(r.gatewayOrderStatus)}</td>
                      <td>
                        <Badge>{text(r.latestPaymentStatus)}</Badge>
                      </td>
                      <td>{text(object(r.attemptStats).count)}</td>
                      <td>
                        {amount(
                          object(r.attemptStats).verifiedPaidMinor,
                          r.currency,
                        )}
                      </td>
                      <td>
                        {r.verifiedAt ? stamp(r.verifiedAt) : "Unverified"}
                      </td>
                      <td>
                        {r.paymentReconciliationLastCode
                          ? text(r.paymentReconciliationLastCode)
                          : r.paymentReconciliationCheckedAt
                            ? "Checked (stored)"
                            : "Not recorded"}
                      </td>
                      <td>
                        {(
                          object(r.subscriptionStats).statuses as
                            string[] | undefined
                        )?.join(", ") || "No linked subscription"}
                      </td>
                      <td>{stamp(r.createdAt)}</td>
                      <td>{stamp(r.updatedAt)}</td>
                      <td>{stamp(r.checkoutExpiresAt)}</td>
                      <td>
                        <Button asChild variant="ghost">
                          <Link href={href(r._id)}>
                            <Eye size={16} />
                            View
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!response.data.length && !query.error && (
              <Empty title="No matching payment orders" />
            )}
            <Pagination info={response.pagination} change={change} />
          </section>
        )
      )}
    </div>
  );
}
function Fields({ entries }: { entries: [string, unknown][] }) {
  return (
    <dl className="a-ledger-details">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{text(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
function AttemptModal({
  id,
  parentId,
  close,
}: {
  id: string;
  parentId: string;
  close: () => void;
}) {
  const query = useAdminQuery<Row>("payments/" + id);
  const r = query.data?.data;
  return (
    <Modal
      title="Payment Transaction"
      description="Stored verification evidence; opening this view does not contact Cashfree."
      open
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      {query.isPending ? (
        <Skeleton />
      ) : query.error ? (
        <ErrorState
          message={query.error.message}
          retry={() => void query.refetch()}
        />
      ) : r && r.resolvedOrderId === parentId ? (
        <>
          <PaymentOrderLink id={r.resolvedOrderId} />
          <CopyId value={r._id} />
          <Fields
            entries={[
              ["Cashfree Payment ID", r.gatewayPaymentId],
              ["Cashfree Order ID", r.gatewayOrderId],
              ["Provider", r.provider],
              ["Amount", amount(r.amountMinor, r.currency)],
              ["Currency", r.currency],
              ["Payment Method", r.method],
              ["Local Status", r.status],
              ["Provider Status", r.gatewayStatus],
              ["Verification", r.verificationStatus],
              ["Verified At", stamp(r.verifiedAt)],
              ["Provider Initiated At", stamp(r.gatewayCreatedAt)],
              ["Review Status", r.reviewStatus],
              ["Review Reason", r.reviewReason],
              ["Refunded", amount(r.refundedAmountMinor, r.currency)],
              [
                "Refund References",
                Array.isArray(r.refundReferences)
                  ? r.refundReferences.join(", ")
                  : undefined,
              ],
              ["Created At", stamp(r.createdAt)],
              ["Updated At", stamp(r.updatedAt)],
            ]}
          />
          <p className="a-muted">
            Failure text and structured dispute details are not stored.
            Reconciliation is shown on the parent order; no status is inferred.
          </p>
        </>
      ) : (
        <Empty title="Payment does not resolve to this order" />
      )}
    </Modal>
  );
}
const relatedColumns: Record<string, [string, string][]> = {
  attempts: [
    ["_id", "Payment Transaction ID"],
    ["gatewayPaymentId", "Cashfree Payment ID"],
    ["status", "Local Status"],
    ["gatewayStatus", "Provider Status"],
    ["amountMinor", "Amount"],
    ["method", "Method"],
    ["verificationStatus", "Verification"],
    ["verifiedAt", "Verified At"],
    ["createdAt", "Created At"],
    ["updatedAt", "Updated At"],
  ],
  subscriptions: [
    ["_id", "Subscription ID"],
    ["planCode", "Plan"],
    ["durationMonths", "Months"],
    ["status", "Stored Status"],
    ["startsAt", "Start"],
    ["expiresAt", "Expiry"],
    ["activatedAt", "Activated At"],
    ["remainingMilliseconds", "Preserved Milliseconds"],
    ["pauseReason", "Pause Reason"],
    ["renewalOf", "Renewal Of"],
    ["createdAt", "Created At"],
    ["updatedAt", "Updated At"],
  ],
  refunds: [
    ["refundId", "Refund ID"],
    ["gatewayRefundId", "Cashfree Refund ID"],
    ["gatewayPaymentId", "Related Payment"],
    ["amountMinor", "Refund Amount"],
    ["gatewayStatus", "Verified Provider Status"],
    ["entitlementReviewRequired", "Entitlement Review"],
    ["verifiedAt", "Verified At"],
    ["createdAt", "Created At"],
    ["updatedAt", "Updated At"],
  ],
  webhooks: [
    ["eventId", "Event ID"],
    ["eventType", "Event Type"],
    ["paymentId", "Payment ID"],
    ["refundId", "Refund ID"],
    ["status", "Inbox Status"],
    ["attempts", "Retry Count"],
    ["lastErrorCode", "Diagnostic"],
    ["nextAttemptAt", "Next Retry"],
    ["createdAt", "Received At"],
    ["processedAt", "Processed At"],
    ["updatedAt", "Updated At"],
  ],
  adminAudit: [
    ["_id", "Audit ID"],
    ["action", "Action"],
    ["result", "Result"],
    ["correlationId", "Request reference"],
    ["createdAt", "Created At"],
    ["updatedAt", "Updated At"],
  ],
  audit: [
    ["eventType", "Event"],
    ["referenceId", "Reference"],
    ["actorType", "Actor Type"],
    ["occurredAt", "Occurred At"],
    ["createdAt", "Recorded At"],
    ["updatedAt", "Updated At"],
  ],
};
export function PaymentOrderDetail({ id }: { id: string }) {
  const session = useAdmin(),
    search = useSearchParams();
  const back = search.get("return") || "";
  const safeBack =
    back && !back.startsWith("?")
      ? "?" + new URLSearchParams(back).toString()
      : "";
  const query = useAdminQuery<Row>("payment-orders/" + id);
  const [kind, setKind] = useState("attempts"),
    [page, setPage] = useState(1),
    [limit, setLimit] = useState(20),
    [attempt, setAttempt] = useState<string | null>(null);
  useEffect(() => {
    const a = search.get("attempt");
    if (a && /^[a-f\d]{24}$/i.test(a)) setAttempt(a);
  }, [search]);
  const records = useAdminQuery<Row[]>(
    `payment-orders/${id}/records?kind=${kind}&page=${page}&limit=${limit}`,
    Boolean(query.data),
  );
  const r = query.data?.data,
    price = object(r?.pricingSnapshot),
    shop = object(r?.shop);
  const cell = (row: Row, key: string) =>
    [
      "createdAt",
      "updatedAt",
      "verifiedAt",
      "startsAt",
      "expiresAt",
      "activatedAt",
      "occurredAt",
      "nextAttemptAt",
      "processedAt",
    ].includes(key)
      ? stamp(row[key])
      : key === "amountMinor"
        ? amount(row[key], row.currency)
        : text(row[key]);
  return (
    <div className="a-order-page">
      <header className="a-page-heading">
        <div>
          <h1>Payment Order Details</h1>
          <p>
            Read-only stored evidence · no verification, recovery or
            subscription transitions are initiated.
          </p>
        </div>
        <div className="a-pagination-controls">
          <Button asChild variant="outline">
            <Link href={"/admin/payment-orders" + safeBack}>
              <ChevronLeft size={16} />
              Payment Orders
            </Link>
          </Button>
          <Button
            variant="outline"
            busy={query.isFetching || records.isFetching}
            onClick={() => {
              void query.refetch();
              void records.refetch();
            }}
          >
            <RefreshCw size={16} />
            Refresh
          </Button>
        </div>
      </header>
      {query.isPending ? (
        <Skeleton />
      ) : query.error ? (
        <ErrorState
          message={query.error.message}
          retry={() => void query.refetch()}
        />
      ) : (
        r && (
          <>
            <section className="a-card a-order-section">
              <h2>Order information</h2>
              <CopyId value={r._id} />
              <Fields
                entries={[
                  ["Cashfree Order ID", r.gatewayOrderId],
                  ["Cashfree Reference (cf_order_id)", r.gatewayReferenceId],
                  ["Cash Payable", amount(r.amountMinor, r.currency)],
                  [
                    "Total Purchase Amount",
                    amount(r.totalAmountMinor, r.currency),
                  ],
                  ["Currency", r.currency],
                  ["Local Order Status", r.status],
                  ["Provider Order Status (cached)", r.gatewayOrderStatus],
                  ["Latest Provider Attempt (cached)", r.latestPaymentStatus],
                  ["Environment", r.appMode],
                  [
                    "Cashfree environment (server policy)",
                    r.appMode === "production" ? "production" : "sandbox",
                  ],
                  ["Created At", stamp(r.createdAt)],
                  ["Updated At", stamp(r.updatedAt)],
                  ["Checkout Expiry", stamp(r.checkoutExpiresAt)],
                  ["Last Successful Order Verification", stamp(r.verifiedAt)],
                  ["Attempt Count", object(r.attemptStats).count],
                  [
                    "Gross Verified Captures",
                    amount(
                      object(r.attemptStats).verifiedPaidMinor,
                      r.currency,
                    ),
                  ],
                ]}
              />
              <p className="a-muted">
                No Cashfree reference or attempt may be expected for a
                full-wallet purchase. Missing references are never reconstructed
                for display.
              </p>
            </section>
            <section className="a-card a-order-section">
              <h2>Shop</h2>
              <Fields
                entries={[
                  ["Name", shop.name],
                  ["Shop ID", r.shopId],
                  ["Owner", shop.owner],
                  ["Mobile", shop.phone],
                  ["Address", shop.address],
                ]}
              />
              <p className="a-muted">
                Shop lifecycle status is not stored on the Shop model.
              </p>
              {session.permissions.includes("shops:read") &&
                Boolean(r.shop) && (
                  <Button asChild variant="outline">
                    <Link href={`/admin/shops/${r.shopId}`}>View Shop</Link>
                  </Button>
                )}
            </section>
            <section className="a-card a-order-section">
              <h2>Historical purchase & subscription</h2>
              <Fields
                entries={[
                  ["Plan", object(price.plan).name || r.planCode],
                  ["Plan Code", r.planCode],
                  [
                    "Confirmed purchase preview",
                    object(object(r.confirmedPreview).outcome).message,
                  ],
                  [
                    "Duration",
                    r.durationMonths
                      ? String(r.durationMonths) + " months"
                      : undefined,
                  ],
                  ["Base Price", amount(price.basePriceMinor, r.currency)],
                  ["Discount", amount(price.discountAmountMinor, r.currency)],
                  ["Tax", amount(price.taxAmountMinor, r.currency)],
                  [
                    "Final Historical Price",
                    amount(price.finalAmountMinor, r.currency),
                  ],
                  ["Wallet Applied", amount(r.walletAppliedMinor, r.currency)],
                  ["Wallet Reservation", r.walletReservationStatus],
                  [
                    "Scheduled Start (purchase record)",
                    stamp(r.scheduledStartAt),
                  ],
                  [
                    "Linked Subscription Count",
                    object(r.subscriptionStats).count,
                  ],
                  [
                    "Stored Subscription Status",
                    (
                      object(r.subscriptionStats).statuses as
                        string[] | undefined
                    )?.join(", ") || "No linked subscription record",
                  ],
                ]}
              />
              <p className="a-muted">
                Prices come from the purchase snapshot. Missing legacy prices
                are unavailable. Payment success alone does not prove
                activation. Renewal references and actual activation dates
                appear in linked records below; no purchase/upgrade type is
                guessed.
              </p>
              {session.permissions.includes("subscriptions:read") && (
                <Button asChild variant="outline">
                  <Link
                    href={`/admin/shops/${r.shopId}#shop-subscription-records`}
                  >
                    View Shop Subscriptions
                  </Link>
                </Button>
              )}
            </section>
            <section className="a-card a-order-section">
              <h2>Reconciliation evidence</h2>
              <Fields
                entries={[
                  ["Review required", r.attention],
                  ["Last Attempt", stamp(r.paymentReconciliationAttemptedAt)],
                  [
                    "Last Provider Check",
                    stamp(r.paymentReconciliationCheckedAt),
                  ],
                  ["Attempt Count", r.paymentReconciliationAttempts],
                  ["Next Attempt", stamp(r.paymentReconciliationNextAt)],
                  ["Last Error Code", r.paymentReconciliationLastCode],
                  ["Refund Check", stamp(r.refundReconciliationCheckedAt)],
                  ["Refund Error Code", r.refundReconciliationLastCode],
                  ["Latest Payment ID", r.latestPaymentId],
                  ["Latest Payment Initiation", stamp(r.latestPaymentTime)],
                ]}
              />
              <p className="a-muted">
                These are cached database observations, not a fresh provider
                check. Existing authorized reconciliation actions remain in
                Payments.
              </p>
            </section>
            <section className="a-card a-order-section">
              <h2>Refunds & disputes</h2>
              <p>
                Related verified refund observations appear below. Refund
                reasons and structured dispute amounts/statuses are not stored.
                Dispute or unsupported lifecycle events are shown only when
                retained in the associated webhook inbox; absence is not proof
                that no dispute exists.
              </p>
              <p>
                No refund, entitlement revocation or dispute action is available
                here.
              </p>
            </section>
            <section className="a-card a-order-section">
              <h2>Related records</h2>
              <div
                className="a-order-tabs"
                role="group"
                aria-label="Related record category"
              >
                {Object.keys(relatedColumns)
                  .filter(
                    (k) =>
                      !["audit", "adminAudit"].includes(k) ||
                      session.permissions.includes("audit:read"),
                  )
                  .map((k) => (
                    <Button
                      key={k}
                      variant={kind === k ? "default" : "outline"}
                      aria-pressed={kind === k}
                      onClick={() => {
                        setKind(k);
                        setPage(1);
                      }}
                    >
                      {k === "webhooks"
                        ? "Webhook / dispute evidence"
                        : k === "adminAudit"
                          ? "Admin audit"
                          : k === "audit"
                            ? "Subscription audit"
                            : label(k)}
                    </Button>
                  ))}
              </div>
              {records.isPending ? (
                <Skeleton />
              ) : records.error ? (
                <ErrorState
                  message={records.error.message}
                  retry={() => void records.refetch()}
                />
              ) : (
                records.data && (
                  <>
                    <div className="a-table-wrap">
                      <table className="a-table">
                        <thead>
                          <tr>
                            {relatedColumns[kind].map(([key, title]) => (
                              <th key={key}>{title}</th>
                            ))}
                            {kind === "attempts" && <th>Actions</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {records.data.data.map((row) => (
                            <tr key={text(row._id)}>
                              {relatedColumns[kind].map(([key]) => (
                                <td key={key}>
                                  {kind === "attempts" && key === "_id" ? (
                                    <button
                                      className="a-order-link"
                                      onClick={() => setAttempt(text(row._id))}
                                    >
                                      {text(row._id)}
                                    </button>
                                  ) : (
                                    cell(row, key)
                                  )}
                                </td>
                              ))}
                              {kind === "attempts" && (
                                <td>
                                  <Button
                                    variant="ghost"
                                    onClick={() => setAttempt(text(row._id))}
                                  >
                                    <Eye size={16} />
                                    View
                                  </Button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!records.data.data.length && (
                      <Empty
                        title="No associated records found"
                        message="No records are fabricated or linked from another shop or environment."
                      />
                    )}
                    <Pagination
                      info={{
                        page,
                        limit,
                        total: records.data.pagination?.total || 0,
                      }}
                      change={(key, v) => {
                        if (key === "page") setPage(Number(v));
                        else {
                          setLimit(Number(v));
                          setPage(1);
                        }
                      }}
                    />
                    <h3>Stored lifecycle evidence · current {kind} page</h3>
                    <p className="a-muted">
                      This is not a complete historical event stream. Updated At
                      is not treated as a payment failure/success timestamp.
                    </p>
                    <ol className="a-order-timeline">
                      {[
                        ...(r.createdAt
                          ? [
                              {
                                at: String(r.createdAt),
                                label: "Payment order created",
                                id: "order-created",
                              },
                            ]
                          : []),
                        ...(r.verifiedAt
                          ? [
                              {
                                at: String(r.verifiedAt),
                                label: "Order verification recorded",
                                id: "order-verified",
                              },
                            ]
                          : []),
                        ...(r.paymentReconciliationAttemptedAt
                          ? [
                              {
                                at: String(r.paymentReconciliationAttemptedAt),
                                label: "Last reconciliation attempted",
                                id: "order-reconcile",
                              },
                            ]
                          : []),
                        ...records.data.data.flatMap((row) => {
                          const entries = [
                            {
                              at: row.createdAt,
                              label:
                                kind === "webhooks"
                                  ? "Webhook received"
                                  : kind === "attempts"
                                    ? "Payment attempt recorded"
                                    : kind === "refunds"
                                      ? "Refund observation recorded"
                                      : kind === "subscriptions"
                                        ? "Subscription record created"
                                        : "Audit recorded",
                            },
                            {
                              at:
                                kind === "audit"
                                  ? row.occurredAt
                                  : kind === "subscriptions"
                                    ? row.activatedAt
                                    : kind === "webhooks"
                                      ? row.processedAt
                                      : row.verifiedAt,
                              label:
                                kind === "audit"
                                  ? text(row.eventType)
                                  : kind === "subscriptions"
                                    ? "Subscription activation recorded"
                                    : kind === "webhooks"
                                      ? "Webhook processed"
                                      : "Provider verification recorded",
                            },
                          ];
                          return entries
                            .filter((e) => typeof e.at === "string")
                            .map((e, i) => ({
                              at: String(e.at),
                              label: e.label,
                              id: text(row._id) + i,
                            }));
                        }),
                      ]
                        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
                        .map((e) => (
                          <li key={e.id}>
                            <time>{stamp(e.at)}</time>
                            <span>{e.label}</span>
                          </li>
                        ))}
                    </ol>
                  </>
                )
              )}
            </section>
          </>
        )
      )}
      {attempt && (
        <AttemptModal
          id={attempt}
          parentId={id}
          close={() => setAttempt(null)}
        />
      )}
    </div>
  );
}
