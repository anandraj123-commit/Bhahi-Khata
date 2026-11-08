"use client";
import { useId, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  Clock3,
  FileQuestion,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Webhook,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useAdminQuery } from "../../../hooks/admin/use-admin-query";
import { adminRequest, AdminApiError, money } from "../../../lib/admin/api";
import { useAdmin } from "../layout/shell";
import { Badge, Button, Skeleton } from "../shared/ui";
import type { DataRow } from "../../../types/admin";

const tabs = [
  { id: "attempts", label: "Payment Attempts", icon: Activity },
  { id: "missing", label: "Missing-order Recovery", icon: FileQuestion },
  {
    id: "verification",
    label: "Payment Verification & Reconciliation",
    icon: ShieldCheck,
  },
  { id: "refunds", label: "Verified Refunds", icon: RotateCcw },
  { id: "webhooks", label: "Webhook Recovery Events", icon: Webhook },
] as const;
type Tab = (typeof tabs)[number]["id"];
type RecordsQuery = ReturnType<typeof useAdminQuery<DataRow[]>>;
const rows = (q: RecordsQuery) =>
  Array.isArray(q.data?.data) ? q.data.data : [];
const text = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : String(v);
const count = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0
    ? v.toLocaleString("en-IN")
    : "Unavailable";
function timestamp(v: unknown) {
  const d = typeof v === "string" || typeof v === "number" ? new Date(v) : null;
  return d && Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(d)
    : "—";
}
function amount(row: DataRow) {
  if (
    typeof row.amountMinor !== "number" ||
    !Number.isSafeInteger(row.amountMinor)
  )
    return "Unavailable";
  const currency = typeof row.currency === "string" ? row.currency : "";
  if (!/^[A-Z]{3}$/.test(currency)) return "Currency unavailable";
  return money(row.amountMinor, currency); // INR for INR records; never relabel another currency.
}
function paymentError(error: Error | null) {
  if (!(error instanceof AdminApiError))
    return "Unable to retrieve payment records";
  if (error.status === 401) return "Session expired — please sign in";
  if (error.status === 403) return "Access denied";
  if (error.status === 404) return "Endpoint or record unavailable";
  if (error.status === 0 || error.code === "ADMIN_BACKEND_UNREACHABLE")
    return "Unable to connect to server";
  return "Unable to retrieve payment records";
}
export function PaymentNotice({
  error,
  retry,
  message,
}: {
  error?: Error | null;
  retry?: () => void;
  message?: string;
}) {
  return (
    <div className="a-payment-error" role="alert">
      <AlertCircle size={17} aria-hidden />
      <div>
        <strong>{message || paymentError(error || null)}</strong>
        {error && (
          <details>
            <summary>Technical details</summary>
            <small>
              {error instanceof AdminApiError
                ? `HTTP ${error.status || "network"} · ${error.code} · `
                : ""}
              {error.message}
            </small>
          </details>
        )}
      </div>
      {retry && (
        <Button variant="outline" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}
function Records({
  query,
  empty,
  children,
}: {
  query: RecordsQuery;
  empty: string;
  children: ReactNode;
}) {
  const hasData = Array.isArray(query.data?.data);
  if (query.isPending) return <Skeleton rows={5} />;
  return (
    <>
      {query.isError && (
        <PaymentNotice error={query.error} retry={() => void query.refetch()} />
      )}
      {query.isFetching && (
        <div
          className="a-loading-line"
          role="status"
          aria-label="Refreshing records"
        />
      )}
      {query.isError && hasData && (
        <p className="a-payment-caption">
          Previously loaded records · refresh failed. These may be out of date.
        </p>
      )}
      {!hasData && !query.isError && (
        <PaymentNotice
          message="The server returned an invalid records response"
          retry={() => void query.refetch()}
        />
      )}
      {hasData && rows(query).length > 0 ? (
        children
      ) : query.isSuccess && hasData ? (
        <div className="a-payment-empty">
          <ShieldCheck size={25} aria-hidden />
          <strong>No records found</strong>
          <p>{empty}</p>
        </div>
      ) : null}
    </>
  );
}
function Status({ value }: { value: unknown }) {
  const normalized = String(value || "").toLowerCase();
  return (
    <Badge
      tone={
        ["paid", "success", "processed", "captured", "verified"].includes(
          normalized,
        )
          ? "success"
          : ["failed", "failure"].includes(normalized)
            ? "failed"
            : ""
      }
    >
      {text(value)}
    </Badge>
  );
}
export function PaymentOrders({
  shopId,
  verification,
}: {
  shopId?: string;
  verification?: ReactNode;
}) {
  const panelId = useId();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("attempts");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState<Error | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const session = useAdmin();
  const scope = shopId ? `&shopId=${shopId}` : "";
  const health = useAdminQuery<DataRow>("payment-health", !shopId);
  const attempts = useAdminQuery<DataRow[]>(`payments?page=1&limit=1${scope}`);
  const missing = useAdminQuery<DataRow[]>(
    "payment-recovery-snapshots?page=1&limit=20",
    !shopId,
  );
  const refunds = useAdminQuery<DataRow[]>(
    `payment-refunds?page=1&limit=20${scope}`,
  );
  const recovery = useAdminQuery<DataRow[]>(
    "payment-recovery-events?page=1&limit=20",
    !shopId,
  );
  const orders = useAdminQuery<DataRow[]>(
    `payment-orders?page=${page}&limit=${limit}${scope}`,
  );
  const availableTabs = tabs.filter(
    (t) => !shopId || !["missing", "webhooks"].includes(t.id),
  );
  const queries = [
    orders,
    attempts,
    refunds,
    ...(!shopId ? [health, missing, recovery] : []),
  ];
  const refreshing = queries.some((q) => q.isFetching);
  const loadedAt = queries
    .filter((q) => q.isSuccess)
    .map((q) => q.dataUpdatedAt)
    .filter(Boolean);
  const updated = loadedAt.length ? Math.min(...loadedAt) : null;
  const healthValue = (key: string) =>
    health.isSuccess ? health.data?.data?.[key] : undefined;
  function refreshVerification() {
    return queryClient.invalidateQueries({
      predicate: (query) => {
        const path = query.queryKey[1];
        if (query.queryKey[0] !== "admin" || typeof path !== "string")
          return false;
        if (path === "dashboard?") return !shopId;
        return (
          path.startsWith("payments?") &&
          new URLSearchParams(path.slice(path.indexOf("?") + 1)).get(
            "shopId",
          ) === (shopId || null)
        );
      },
    });
  }
  async function reconcile(id: string) {
    setBusyId(id);
    setActionError(null);
    setMessage("");
    try {
      const result = await adminRequest<{ status: string }>(
        `payment-orders/${id}/reconcile`,
        { method: "POST", csrf: session.csrfToken },
      );
      setMessage(`Server verification: ${result.data.status}`);
      await Promise.all([
        orders.refetch(),
        refreshVerification(),
        ...(!shopId ? [missing.refetch(), health.refetch()] : []),
      ]);
    } catch (error) {
      setActionError(
        error instanceof Error ? error : new Error("Verification unavailable"),
      );
    } finally {
      setBusyId(null);
    }
  }
  function refresh() {
    for (const q of queries) if (q !== attempts) void q.refetch();
    void refreshVerification();
  }
  function action(row: DataRow) {
    return session.permissions.includes("payments:reconcile") ? (
      <Button
        variant="outline"
        busy={busyId === String(row._id)}
        disabled={busyId !== null}
        onClick={() => void reconcile(String(row._id))}
      >
        <ShieldCheck size={14} />
        Verify with gateway
      </Button>
    ) : (
      <span className="a-muted">Read only</span>
    );
  }
  const summaries = [
    {
      title: "Total Payment Attempts",
      value: attempts.isSuccess ? attempts.data?.pagination?.total : undefined,
      icon: Activity,
      target: "verification" as Tab,
      note: "Recorded payment transactions",
      loading: attempts.isPending,
    },
    {
      title: "Pending Reconciliation",
      value: healthValue("pendingReconciliation"),
      icon: Clock3,
      target: "attempts" as Tab,
      note: shopId
        ? "Global metric · unavailable here"
        : "Created and pending orders",
      loading: !shopId && health.isPending,
    },
    {
      title: "Missing Orders Requiring Review",
      value: healthValue("missingOrderReviews"),
      icon: FileQuestion,
      target: "missing" as Tab,
      note: shopId
        ? "Global metric · unavailable here"
        : "Recovery records flagged for review",
      loading: !shopId && health.isPending,
    },
    {
      title: "Verified Refunds",
      value: healthValue("verifiedRefunds"),
      icon: RotateCcw,
      target: "refunds" as Tab,
      note: shopId
        ? "See provider status in records"
        : "Provider-checked, including pending / failed",
      loading: !shopId && health.isPending,
    },
    {
      title: "Failed Webhook Events",
      value: healthValue("failedWebhookEvents"),
      icon: Webhook,
      target: "webhooks" as Tab,
      note: shopId
        ? "Global metric · unavailable here"
        : "Stored event status: failed",
      loading: !shopId && health.isPending,
    },
  ];
  const selectedQuery =
    tab === "missing"
      ? missing
      : tab === "refunds"
        ? refunds
        : tab === "webhooks"
          ? recovery
          : orders;
  const total = orders.data?.pagination?.total;
  return (
    <section className="a-payments" aria-label="Payments and reconciliation">
      <header className="a-payment-header">
        <div>
          <span className="a-eyebrow">PAYMENT OPERATIONS</span>
          {shopId ? (
            <h2>Payments &amp; Reconciliation</h2>
          ) : (
            <h1>Payments &amp; Reconciliation</h1>
          )}
          <p>
            Inspect payment attempts, verify outcomes and track recovery work.
          </p>
        </div>
        <div className="a-payment-refresh">
          <small>
            {updated
              ? `Records refreshed ${timestamp(updated)} UTC`
              : "Awaiting payment data"}
          </small>
          <Button variant="outline" busy={refreshing} onClick={refresh}>
            <RefreshCw size={15} />
            Refresh
          </Button>
        </div>
      </header>
      <div className="a-payment-metrics">
        {summaries.map(
          ({ title, value, icon: Icon, target, note, loading }) => (
            <button
              className="a-payment-metric"
              key={title}
              disabled={!availableTabs.some((t) => t.id === target)}
              onClick={() => setTab(target)}
            >
              <span>
                <Icon size={17} aria-hidden />
                {title}
              </span>
              {loading ? (
                <span
                  className="a-payment-metric-loading"
                  aria-label="Loading summary"
                />
              ) : (
                <strong>{count(value)}</strong>
              )}
              <small>{note}</small>
            </button>
          ),
        )}
      </div>
      {((!shopId && health.isError) || attempts.isError) && (
        <PaymentNotice
          message="Some payment summaries are unavailable"
          error={
            new Error(
              [
                ...(!shopId && health.isError
                  ? [
                      `Health summary: ${paymentError(health.error)}. ${health.error.message}`,
                    ]
                  : []),
                ...(attempts.isError
                  ? [
                      `Payment count: ${paymentError(attempts.error)}. ${attempts.error.message}`,
                    ]
                  : []),
              ].join(" · "),
            )
          }
          retry={() => {
            void attempts.refetch();
            if (!shopId) void health.refetch();
          }}
        />
      )}
      {!shopId && health.isSuccess && (
        <details className="a-payment-health">
          <summary>Reconciliation health</summary>
          <div>
            Webhook backlog: {count(healthValue("webhookBacklog"))} · Over one
            hour: {count(healthValue("overdueWebhooks"))} · Order errors:{" "}
            {count(healthValue("orderErrors"))} · Refund errors:{" "}
            {count(healthValue("refundErrors"))} · Missing-order reviews:{" "}
            {count(healthValue("missingOrderReviews"))}
          </div>
        </details>
      )}
      {actionError && <PaymentNotice error={actionError} />}
      {message && (
        <p role="status" className="a-payment-success">
          <ShieldCheck size={16} />
          {message}
        </p>
      )}
      <div className="a-card a-payment-workspace">
        <div
          role="tablist"
          aria-label="Payment record views"
          className="a-payment-tabs"
        >
          {availableTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={`${panelId}-${id}-tab`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`${panelId}-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                const index = availableTabs.findIndex((t) => t.id === id);
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % availableTabs.length
                    : event.key === "ArrowLeft"
                      ? (index - 1 + availableTabs.length) %
                        availableTabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? availableTabs.length - 1
                          : -1;
                if (next >= 0) {
                  event.preventDefault();
                  setTab(availableTabs[next].id);
                  document
                    .getElementById(`${panelId}-${availableTabs[next].id}-tab`)
                    ?.focus();
                }
              }}
            >
              <Icon size={16} aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <div className="a-payment-panel-heading">
          <div>
            <h3>{tabs.find((t) => t.id === tab)?.label}</h3>
            <p>
              {tab === "attempts"
                ? "Checkout orders and their latest provider payment attempt. All timestamps are UTC."
                : tab === "verification"
                  ? "Payment history, verification, pricing and subscription outcomes."
                  : "Latest 20 records · recorded server state · timestamps in UTC"}
            </p>
          </div>
          {tab !== "verification" && (
            <Button
              variant="ghost"
              busy={selectedQuery.isFetching}
              onClick={() => void selectedQuery.refetch()}
            >
              <RefreshCw size={14} />
              Refresh {tab === "webhooks" ? "recovery events" : "records"}
            </Button>
          )}
        </div>
        <div
          id={`${panelId}-attempts`}
          role="tabpanel"
          aria-labelledby={`${panelId}-attempts-tab`}
          hidden={tab !== "attempts"}
        >
          <Records
            query={orders}
            empty="No checkout orders match this shop or environment."
          >
            <div className="a-table-wrap">
              <table className="a-table a-payment-table">
                <thead>
                  <tr>
                    <th>Shop / order</th>
                    <th>Plan</th>
                    <th className="a-payment-number">Amount</th>
                    <th>Status</th>
                    <th>Verification</th>
                    <th>Reconciliation</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows(orders).map((row) => (
                    <tr key={text(row._id)}>
                      <td>
                        <strong>{text(row.shopName)}</strong>
                        <small className="a-payment-reference">
                          {text(row.gatewayOrderId || row._id)}
                        </small>
                        <small>{timestamp(row.createdAt)}</small>
                      </td>
                      <td>{text(row.planCode)}</td>
                      <td className="a-payment-number">{amount(row)}</td>
                      <td>
                        <Status value={row.status} />
                        <small>
                          Gateway order: {text(row.gatewayOrderStatus)}
                        </small>
                        <small>
                          Latest attempt:{" "}
                          <Status value={row.latestPaymentStatus} />
                        </small>
                        <small className="a-payment-reference">
                          {text(row.latestPaymentId)}
                        </small>
                      </td>
                      <td>
                        {row.verifiedAt ? (
                          timestamp(row.verifiedAt)
                        ) : (
                          <span className="a-muted">Unverified</span>
                        )}
                      </td>
                      <td>
                        <span className="a-payment-reference">
                          {text(row.paymentReconciliationLastCode)}
                        </span>
                        <small>
                          Last checked:{" "}
                          {timestamp(row.paymentReconciliationCheckedAt)}
                        </small>
                        <small>
                          Attempts: {count(row.paymentReconciliationAttempts)} ·
                          Next: {timestamp(row.paymentReconciliationNextAt)}
                        </small>
                      </td>
                      <td>{action(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Records>
          <div className="a-pagination">
            <span>
              Page {page}
              {typeof total === "number"
                ? ` · ${total.toLocaleString("en-IN")} orders`
                : ""}
            </span>
            <div className="a-pagination-controls">
              <label>
                Rows{" "}
                <select
                  className="a-select"
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <Button
                variant="outline"
                disabled={page === 1 || orders.isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={14} />
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={
                  !orders.isSuccess ||
                  orders.isFetching ||
                  (typeof total === "number"
                    ? page * limit >= total
                    : rows(orders).length < limit)
                }
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </div>
        {!shopId && (
          <div
            id={`${panelId}-missing`}
            role="tabpanel"
            aria-labelledby={`${panelId}-missing-tab`}
            hidden={tab !== "missing"}
          >
            <Records
              query={missing}
              empty="No recovery records are flagged for investigation."
            >
              <div className="a-table-wrap">
                <table className="a-table a-payment-table">
                  <thead>
                    <tr>
                      <th>Recovery / order ID</th>
                      <th>Diagnostic code</th>
                      <th>Next verification</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows(missing).map((row) => (
                      <tr key={text(row._id)}>
                        <td className="a-payment-reference">{text(row._id)}</td>
                        <td>{text(row.reconciliationLastCode)}</td>
                        <td>{timestamp(row.reconciliationNextAt)}</td>
                        <td>{action(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Records>
          </div>
        )}
        <div
          id={`${panelId}-verification`}
          role="tabpanel"
          aria-labelledby={`${panelId}-verification-tab`}
          hidden={tab !== "verification"}
        >
          {verification || (
            <div className="a-payment-empty">
              Payment history is unavailable in this context.
            </div>
          )}
        </div>
        <div
          id={`${panelId}-refunds`}
          role="tabpanel"
          aria-labelledby={`${panelId}-refunds-tab`}
          hidden={tab !== "refunds"}
        >
          <Records
            query={refunds}
            empty="No refund records have been returned for this scope."
          >
            <div className="a-table-wrap">
              <table className="a-table a-payment-table">
                <thead>
                  <tr>
                    <th>Refund reference</th>
                    <th>Payment reference</th>
                    <th>Provider status</th>
                    <th className="a-payment-number">Amount</th>
                    <th>Provider checked</th>
                    <th>Entitlement review</th>
                  </tr>
                </thead>
                <tbody>
                  {rows(refunds).map((row) => (
                    <tr key={text(row._id)}>
                      <td className="a-payment-reference">
                        {text(row.gatewayRefundId)}
                      </td>
                      <td className="a-payment-reference">
                        {text(row.gatewayPaymentId)}
                      </td>
                      <td>
                        <Status value={row.gatewayStatus} />
                      </td>
                      <td className="a-payment-number">{amount(row)}</td>
                      <td>{timestamp(row.verifiedAt)}</td>
                      <td>
                        {row.entitlementReviewRequired === true ? (
                          <Badge>Review required</Badge>
                        ) : row.entitlementReviewRequired === false ? (
                          "No review flagged"
                        ) : (
                          "Unavailable"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Records>
        </div>
        {!shopId && (
          <div
            id={`${panelId}-webhooks`}
            role="tabpanel"
            aria-labelledby={`${panelId}-webhooks-tab`}
            hidden={tab !== "webhooks"}
          >
            <Records
              query={recovery}
              empty="No webhook recovery events have been recorded."
            >
              <div className="a-table-wrap">
                <table className="a-table a-payment-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Order reference</th>
                      <th>Status</th>
                      <th>Diagnostic code</th>
                      <th className="a-payment-number">Retries</th>
                      <th>Next retry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows(recovery).map((row) => (
                      <tr key={text(row._id)}>
                        <td>{text(row.eventType)}</td>
                        <td className="a-payment-reference">
                          {text(row.orderId)}
                        </td>
                        <td>
                          <Status value={row.status} />
                        </td>
                        <td>{text(row.lastErrorCode)}</td>
                        <td className="a-payment-number">
                          {count(row.attempts)}
                        </td>
                        <td>{timestamp(row.nextAttemptAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Records>
          </div>
        )}
      </div>
    </section>
  );
}
