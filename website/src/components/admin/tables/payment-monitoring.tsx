"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Search, Eye } from "lucide-react";
import {
  useAdminQuery,
  useDebounced,
} from "../../../hooks/admin/use-admin-query";
import { money } from "../../../lib/admin/api";
import type { DataRow } from "../../../types/admin";
import { Badge, Button, Empty, Modal, Skeleton } from "../shared/ui";
import { PaymentAttemptModal } from "./payment-order-management";
import { PaymentNotice } from "./payment-orders";
import { PaymentOrderLink } from "../shared/payment-order-link";
import { ShopSelect } from "../filters/transaction-filters";

type Kind = "attempts" | "webhooks" | "recoveries" | "refunds";
type Column = [string, string];
const common: Column[] = [
  ["createdAt", "Created At"],
  ["updatedAt", "Updated At"],
];
const shop: Column[] = [
  ["shopName", "Shop"],
  ["shopId", "Shop ID"],
];
const order: Column = ["resolvedOrderId", "Payment Order ID"];
const config: Record<
  Kind,
  { title: string; description: string; statuses: string[]; columns: Column[] }
> = {
  attempts: {
    title: "Payment Transactions",
    description:
      "Stored gateway payment attempts, separate from customer ledger transactions. Verification and provider status are shown independently.",
    statuses: [
      "captured",
      "pending",
      "failed",
      "refunded",
      "partially_refunded",
    ],
    columns: [
      ["_id", "Payment Transaction ID"],
      order,
      ["orderId", "Stored local order reference"],
      ["gatewayOrderId", "Cashfree / gateway order ID"],
      ["gatewayPaymentId", "Gateway payment ID"],
      ...shop,
      ["provider", "Provider"],
      ["amountMinor", "Attempt amount"],
      ["currency", "Currency"],
      ["method", "Payment method"],
      ["status", "Local status"],
      ["gatewayStatus", "Provider status"],
      ["verificationStatus", "Verification"],
      ["verifiedAt", "Verified At"],
      ["reviewStatus", "Review status"],
      ["reviewReason", "Review reason"],
      ["refundedAmountMinor", "Recorded refunded amount"],
      ["gatewayCreatedAt", "Provider creation time"],
      ...common,
    ],
  },
  webhooks: {
    title: "Webhook Events",
    description:
      "Stored webhook inbox evidence. Retry failures are not delivery counts. Legacy records may not contain environment or payment references.",
    statuses: ["received", "processed", "failed"],
    columns: [
      ["_id", "Webhook record ID"],
      ["eventId", "Deduplication hash"],
      ["eventType", "Event type"],
      ["appMode", "Recorded event environment"],
      ["resolvedAttemptId", "Related payment transaction"],
      order,
      ["orderId", "Provider order reference"],
      ["paymentId", "Provider payment reference"],
      ["refundId", "Refund reference"],
      ...shop,
      ["status", "Processing status"],
      ["attempts", "Retry failures"],
      ["lastErrorCode", "Diagnostic code"],
      ["nextAttemptAt", "Next retry"],
      ["processedAt", "Processed At"],
      ...common,
    ],
  },
  recoveries: {
    title: "Payment Recoveries",
    description:
      "Server-authored purchase evidence retained for missing-order recovery. Parent presence is a relationship, not proof of payment or completed recovery. No job status, attempt count or completion timestamp is stored.",
    statuses: ["parent_present", "parent_missing", "review_flagged"],
    columns: [
      ["_id", "Recovery / original local order ID"],
      order,
      ...shop,
      ["parentState", "Parent relationship"],
      ["reconciliationLastCode", "Recorded review code"],
      ["reconciliationNextAt", "Next scheduled check"],
      ...common,
    ],
  },
  refunds: {
    title: "Refunds & Disputes",
    description:
      "Provider-verified refund observations. Verified means checked with the provider; only SUCCESS means completed. Opening this view never initiates a refund.",
    statuses: ["SUCCESS", "PENDING", "CANCELLED", "ONHOLD", "FAILED"],
    columns: [
      ["_id", "Refund record ID"],
      ["refundId", "Merchant refund ID"],
      ["gatewayRefundId", "Cashfree refund reference"],
      ["resolvedAttemptId", "Related payment transaction"],
      order,
      ["gatewayOrderId", "Gateway order ID"],
      ["gatewayPaymentId", "Gateway payment ID"],
      ...shop,
      ["amountMinor", "Refund amount"],
      ["currency", "Currency"],
      ["gatewayStatus", "Provider refund status"],
      ["verifiedAt", "Provider checked At"],
      ["entitlementReviewRequired", "Entitlement review required"],
      ...common,
    ],
  },
};
const label = (value: string) => value.replaceAll("_", " ");
const text = (value: unknown) =>
  value === undefined || value === null || value === ""
    ? "Unavailable"
    : String(value);
function stamp(value: unknown) {
  const date =
    typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  return date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(date) + " UTC"
    : "Unavailable";
}
function Cell({ field, row }: { field: string; row: DataRow }) {
  const value = row[field];
  if (field === "appMode")
    return <>{value ? text(value) : "Not recorded (legacy)"}</>;
  if (field === "resolvedAttemptId")
    return value && row.resolvedOrderId ? (
      <Link
        href={`/admin/payment-orders/${String(row.resolvedOrderId)}?attempt=${String(value)}`}
      >
        {String(value)}
      </Link>
    ) : (
      <>Unavailable</>
    );
  if (field === "resolvedOrderId") return <PaymentOrderLink id={value} />;
  if (field === "shopName")
    return row.shopId ? (
      <Link href={`/admin/shops/${String(row.shopId)}`}>{text(value)}</Link>
    ) : (
      <>{text(value)}</>
    );
  if (field.endsWith("At")) return <>{stamp(value)}</>;
  if (field.endsWith("Minor"))
    return (
      <>
        {typeof value === "number" &&
        typeof row.currency === "string" &&
        /^[A-Z]{3}$/.test(row.currency)
          ? money(value, row.currency)
          : "Unavailable"}
      </>
    );
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (field.toLowerCase().includes("status") || field === "parentState")
    return (
      <Badge tone={String(value).toLowerCase()}>{label(text(value))}</Badge>
    );
  return <>{text(value)}</>;
}
export function PaymentMonitoring({ kind }: { kind: Kind }) {
  const c = config[kind],
    router = useRouter(),
    path = usePathname(),
    search = useSearchParams();
  const [draft, setDraft] = useState(search.get("q") || "");
  const q = draft.trim();
  const [selected, setSelected] = useState<DataRow | null>(null);
  const [, setShop] = useState<{ id: string; name: string } | null>(null);
  const get = (key: string, fallback = "") => search.get(key) || fallback;
  useEffect(() => {
    setDraft(search.get("q") || "");
  }, [search]);
  const page = Math.max(1, Number(get("page", "1")) || 1),
    limit = [20, 50, 100].includes(Number(get("limit")))
      ? Number(get("limit"))
      : 20;
  function change(key: string, value: string) {
    const next = new URLSearchParams(search.toString());
    next.delete("page");
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${path}?${next.toString()}`, { scroll: false });
  }
  // The text term is debounced and never fetched with a previous page number.
  const params = new URLSearchParams();
  for (const key of [
    "shopId",
    "status",
    "eventType",
    "from",
    "to",
    "dateField",
    "sort",
    "direction",
  ])
    if (get(key)) params.set(key, get(key));
  params.set("q", q);
  params.set("page", String(q === get("q") ? page : 1));
  params.set("limit", String(limit));
  const invalid = Boolean(get("from") && get("to") && get("from") > get("to"));
  const debouncedParams = useDebounced(params.toString(), 300);
  const applying = debouncedParams !== params.toString();
  const records = useAdminQuery<DataRow[]>(
    `payment-monitoring/${kind}?${debouncedParams}`,
    !invalid && !applying,
  );
  const pagination = records.data?.pagination;
  const validResponse =
    Array.isArray(records.data?.data) &&
    records.data.data.every(
      (row) =>
        row !== null &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        typeof row._id === "string",
    ) &&
    Boolean(
      pagination &&
      Number.isSafeInteger(pagination.total) &&
      pagination.total >= 0 &&
      Number.isSafeInteger(pagination.page) &&
      pagination.page >= 1 &&
      [20, 50, 100].includes(pagination.limit),
    );
  const data = validResponse ? records.data!.data : null;
  const total = validResponse ? pagination!.total : undefined;
  const scope = (
    records.data as
      | {
          scope?: {
            total?: number;
            legacy?: number;
            legacyIncludedFromIsolatedDatabase?: boolean;
          };
        }
      | undefined
  )?.scope;
  const scopeTotal =
    Number.isSafeInteger(scope?.total) && scope!.total! >= 0
      ? scope!.total
      : undefined;
  const legacyCount =
    Number.isSafeInteger(scope?.legacy) && scope!.legacy! >= 0
      ? scope!.legacy
      : undefined;
  const pages =
    typeof total === "number" ? Math.max(1, Math.ceil(total / limit)) : 1;
  function go(nextPage: number) {
    const next = new URLSearchParams(search.toString());
    next.set("q", q);
    next.set("page", String(nextPage));
    router.replace(`${path}?${next}`, { scroll: false });
  }
  const select = (
    key: string,
    title: string,
    options: string[],
    all = true,
  ) => (
    <label className="a-filter-field">
      {title}
      <select
        className="a-select"
        value={get(key, all ? "" : options[0])}
        onChange={(e) => change(key, e.target.value)}
      >
        {all && <option value="">All</option>}
        {options.map((v) => (
          <option key={v} value={v}>
            {label(v)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section>
      <header className="a-payment-header">
        <div>
          <h1>{c.title}</h1>
          <p>{c.description}</p>
        </div>
        <div className="a-payment-refresh">
          <small>
            {records.dataUpdatedAt
              ? `Last loaded ${stamp(records.dataUpdatedAt)}`
              : "Awaiting records"}
          </small>
          <Button
            variant="outline"
            busy={records.isFetching}
            disabled={invalid || applying}
            onClick={() => void records.refetch()}
          >
            <RefreshCw size={16} />
            Refresh
          </Button>
        </div>
      </header>
      <p className="a-muted">
        Read-only · environment:{" "}
        {text(
          (records.data as { environment?: string } | undefined)?.environment,
        )}{" "}
        · timestamps in UTC.{" "}
        <Link href="/admin/payments">
          Open original dashboard and authorized reconciliation controls
        </Link>
      </p>
      {kind === "webhooks" && records.isSuccess && validResponse && (
        <div className="a-notice" role="status">
          <strong>
            {scopeTotal === undefined
              ? "Database-scope total unavailable"
              : `${scopeTotal.toLocaleString("en-IN")} webhook records in the authorized database scope`}
          </strong>
          {typeof legacyCount === "number" && legacyCount > 0 && (
            <p>
              {legacyCount.toLocaleString("en-IN")} legacy records have no
              recorded event environment. They are shown from the verified
              environment-specific database; missing payment and shop references
              remain unavailable.
            </p>
          )}
          {get("shopId") && (
            <p>
              Shop filtering includes only events linked to that shop. Events
              without a resolvable order cannot match a shop filter.
            </p>
          )}
        </div>
      )}
      {kind === "refunds" && (
        <div className="a-notice">
          <strong>Dispute monitoring unavailable</strong>
          <p>
            No structured dispute records or lifecycle are implemented. Retained
            lifecycle-review events can be inspected in{" "}
            <Link href="/admin/webhook-events?status=failed">
              Webhook Events
            </Link>
            . Refunds do not automatically revoke subscription entitlement.
          </p>
        </div>
      )}
      <div className="a-card a-monitor-filters">
        <label className="a-filter-field">
          <span>
            <Search size={15} /> Search exact record, order or provider
            reference
          </span>
          <input
            className="a-input"
            value={draft}
            maxLength={100}
            onChange={(e) => {
              setDraft(e.target.value);
              change("q", e.target.value.trim());
            }}
            placeholder={
              kind === "recoveries"
                ? "Recovery ID or diagnostic code"
                : "Exact ID or provider reference"
            }
          />
        </label>
        <ShopSelect
          value={get("shopId")}
          onChange={(v) => change("shopId", v)}
          onLabel={setShop}
        />
        {select(
          "status",
          kind === "recoveries" ? "Relationship / review" : "Status",
          c.statuses,
        )}
        {kind === "webhooks" && (
          <label className="a-filter-field">
            Event type
            <input
              className="a-input"
              maxLength={100}
              value={get("eventType")}
              onChange={(e) => change("eventType", e.target.value)}
              placeholder="Exact stored event type"
            />
          </label>
        )}
        {select("dateField", "Date field", ["createdAt", "updatedAt"], false)}
        <label className="a-filter-field">
          Start date
          <input
            className="a-input"
            type="date"
            value={get("from")}
            onChange={(e) => change("from", e.target.value)}
          />
        </label>
        <label className="a-filter-field">
          End date
          <input
            className="a-input"
            type="date"
            value={get("to")}
            min={get("from")}
            onChange={(e) => change("to", e.target.value)}
          />
        </label>
        {select("sort", "Sort by", ["createdAt", "updatedAt"], false)}
        {select("direction", "Sort direction", ["desc", "asc"], false)}
        <Button
          variant="outline"
          onClick={() => {
            setDraft("");
            router.replace(path, { scroll: false });
          }}
        >
          Reset filters
        </Button>
      </div>
      {invalid && (
        <PaymentNotice message="End date must be on or after start date" />
      )}
      {records.isError && (
        <PaymentNotice
          error={records.error}
          retry={() => void records.refetch()}
        />
      )}
      {kind === "webhooks" &&
        records.isSuccess &&
        validResponse &&
        scopeTotal === undefined && (
          <PaymentNotice
            message="The backend response lacks webhook scope information. Ensure the running backend has loaded the updated monitoring route; an empty response cannot yet establish that no webhook records exist."
            retry={() => void records.refetch()}
          />
        )}
      {records.isSuccess && !data && (
        <PaymentNotice
          message="The server returned an invalid records response"
          retry={() => void records.refetch()}
        />
      )}
      {records.isError && data && (
        <p role="status">Previously loaded records; refresh failed.</p>
      )}
      {!invalid && records.isPending ? (
        <Skeleton />
      ) : (
        data && (
          <>
            <p role="status">
              {typeof total === "number"
                ? `${total.toLocaleString("en-IN")} matching records`
                : "Record count unavailable"}
              {records.isFetching || applying
                ? " · Updating filters / records…"
                : ""}
            </p>
            {data.length ? (
              <div className="a-card a-table-wrap">
                <table className="a-table a-payment-table">
                  <thead>
                    <tr>
                      {c.columns.map(([key, title]) => (
                        <th key={key}>{title}</th>
                      ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row) => (
                      <tr key={String(row._id)}>
                        {c.columns.map(([key]) => (
                          <td
                            key={key}
                            className={
                              key.endsWith("Minor")
                                ? "a-payment-number"
                                : undefined
                            }
                          >
                            <Cell field={key} row={row} />
                          </td>
                        ))}
                        <td>
                          <Button
                            variant="outline"
                            onClick={() => setSelected(row)}
                          >
                            <Eye size={15} />
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : records.isSuccess &&
              (kind !== "webhooks" || scopeTotal !== undefined) ? (
              <div>
                <Empty
                  title={
                    total && total > 0
                      ? "No records on this page"
                      : kind === "webhooks" && scopeTotal === 0
                        ? "No webhook records in this database scope"
                        : "No matching records"
                  }
                  message={
                    total && total > 0
                      ? "Matching records exist, but this page is beyond the available results."
                      : kind === "webhooks" &&
                          typeof scopeTotal === "number" &&
                          scopeTotal > 0
                        ? `${scopeTotal.toLocaleString("en-IN")} records exist in the authorized database scope, but the current filters exclude them.`
                        : kind === "webhooks" && scopeTotal === 0
                          ? "The query succeeded. No events are available in the current authorized environment scope; this does not describe other environments."
                          : "The query succeeded. Reset filters to inspect the available records."
                  }
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    if (total && total > 0) go(1);
                    else {
                      setDraft("");
                      router.replace(path, { scroll: false });
                    }
                  }}
                >
                  {total && total > 0 ? "Go to first page" : "Clear filters"}
                </Button>
              </div>
            ) : null}
            <div className="a-pagination">
              <span>
                {typeof total === "number"
                  ? `Showing ${data.length ? (page - 1) * limit + 1 : 0}–${Math.min(page * limit, total)} of ${total}`
                  : "Total unavailable"}{" "}
                · Page {page} of {pages}
              </span>
              <div className="a-pagination-controls">
                <label>
                  Rows{" "}
                  <select
                    className="a-select"
                    value={limit}
                    onChange={(e) => change("limit", e.target.value)}
                  >
                    {[20, 50, 100].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="outline"
                  disabled={page <= 1 || records.isFetching || applying}
                  onClick={() => go(page - 1)}
                >
                  Previous
                </Button>
                {Array.from(
                  { length: Math.min(5, pages) },
                  (_, i) =>
                    Math.min(Math.max(1, page - 2), Math.max(1, pages - 4)) + i,
                ).map((n) => (
                  <Button
                    key={n}
                    variant={page === n ? "default" : "outline"}
                    aria-current={page === n ? "page" : undefined}
                    disabled={records.isFetching || applying}
                    onClick={() => go(n)}
                  >
                    {n}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  disabled={page >= pages || records.isFetching || applying}
                  onClick={() => go(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )
      )}
      {kind === "attempts" && selected ? (
        <PaymentAttemptModal
          id={String(selected._id)}
          close={() => setSelected(null)}
        />
      ) : (
        <Modal
          title={`${c.title} · record details`}
          description="Stored evidence only. Missing values are unavailable; no financial operation is performed."
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        >
          {selected && (
            <>
              <dl className="a-detail-grid">
                {c.columns.map(([key, title]) => (
                  <div key={key}>
                    <dt>{title}</dt>
                    <dd>
                      <Cell field={key} row={selected} />
                    </dd>
                  </div>
                ))}
              </dl>
              {kind === "attempts" && Boolean(selected.resolvedOrderId) && (
                <Link
                  className="a-button a-button-outline"
                  href={`/admin/payment-orders/${String(selected.resolvedOrderId)}?attempt=${String(selected._id)}`}
                >
                  View order, subscription and payment evidence
                </Link>
              )}
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
