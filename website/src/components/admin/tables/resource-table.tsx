"use client";
import { useState } from "react";
import Link from "next/link";
import { Search, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import type { DataRow, Dashboard } from "../../../types/admin";
import {
  useAdminQuery,
  useDebounced,
} from "../../../hooks/admin/use-admin-query";
import { date, money } from "../../../lib/admin/api";
import { Badge, Button, Empty, ErrorState, Skeleton } from "../shared/ui";
import { DateFilter } from "../shared/date-filter";
export type Resource =
  "shops" | "subscriptions" | "payments" | "audit-logs" | "administrators";
type Column = {
  key: string;
  label: string;
  render?: (row: DataRow) => React.ReactNode;
};
const status = (value: unknown) => (
  <Badge tone={String(value)}>{String(value || "Unavailable")}</Badge>
);
const columns: Record<Resource, Column[]> = {
  shops: [
    {
      key: "name",
      label: "Shop",
      render: (r) => (
        <Link href={`/admin/shops/${r._id}`}>
          {String(r.name || "Unnamed shop")}
          <small>{String(r._id)}</small>
        </Link>
      ),
    },
    { key: "owner", label: "Owner" },
    {
      key: "accountStatus",
      label: "Account",
      render: (r) => status(r.accountStatus),
    },
    { key: "planCode", label: "Current plan" },
    {
      key: "subscriptionExpiresAt",
      label: "Plan expiry",
      render: (r) => date(r.subscriptionExpiresAt),
    },
    { key: "createdAt", label: "Registered", render: (r) => date(r.createdAt) },
  ],
  subscriptions: [
    {
      key: "shopName",
      label: "Shop",
      render: (r) => (
        <Link href={`/admin/shops/${r.shopId}`}>{String(r.shopName)}</Link>
      ),
    },
    { key: "planCode", label: "Plan" },
    {
      key: "status",
      label: "Recorded status",
      render: (r) => status(r.status),
    },
    { key: "startsAt", label: "Starts", render: (r) => date(r.startsAt) },
    { key: "expiresAt", label: "Expires", render: (r) => date(r.expiresAt) },
    { key: "durationMonths", label: "Months" },
  ],
  payments: [
    {
      key: "gatewayPaymentId",
      label: "Payment reference",
      render: (r) => (
        <>
          {String(r.gatewayPaymentId)}
          <small>{String(r.gatewayOrderId)}</small>
        </>
      ),
    },
    {
      key: "shopName",
      label: "Shop",
      render: (r) => (
        <Link href={`/admin/shops/${r.shopId}`}>{String(r.shopName)}</Link>
      ),
    },
    {
      key: "amountMinor",
      label: "Amount",
      render: (r) => money(Number(r.amountMinor), String(r.currency)),
    },
    {
      key: "refundedAmountMinor",
      label: "Refunded",
      render: (r) =>
        money(Number(r.refundedAmountMinor || 0), String(r.currency)),
    },
    { key: "status", label: "Status", render: (r) => status(r.status) },
    {
      key: "verificationStatus",
      label: "Verification",
      render: (r) => status(r.verificationStatus),
    },
    { key: "verifiedAt", label: "Verified", render: (r) => date(r.verifiedAt) },
    { key: "createdAt", label: "Recorded", render: (r) => date(r.createdAt) },
  ],
  "audit-logs": [
    { key: "action", label: "Action" },
    { key: "adminId", label: "Administrator ID" },
    { key: "targetType", label: "Resource" },
    { key: "targetId", label: "Resource ID" },
    { key: "result", label: "Result", render: (r) => status(r.result) },
    {
      key: "createdAt",
      label: "Time (UTC)",
      render: (r) =>
        typeof r.createdAt === "string"
          ? new Date(r.createdAt).toISOString().replace("T", " ").slice(0, 19)
          : "—",
    },
    { key: "correlationId", label: "Request ID" },
  ],
  administrators: [
    {
      key: "name",
      label: "Administrator",
      render: (r) => (
        <>
          {String(r.name)}
          <small>{String(r.email)}</small>
        </>
      ),
    },
    { key: "role", label: "Role" },
    {
      key: "active",
      label: "Account",
      render: (r) => status(r.active ? "enabled" : "disabled"),
    },
    {
      key: "lastLoginAt",
      label: "Last sign-in",
      render: (r) => date(r.lastLoginAt),
    },
  ],
};
const statuses: Partial<Record<Resource, string[]>> = {
  shops: ["enabled", "disabled", "unavailable"],
  subscriptions: ["active", "expiring", "expired", "scheduled", "cancelled"],
  payments: ["captured", "pending", "failed", "refunded", "partially_refunded"],
};
export function ResourceTable({
  resource,
  shopId,
  adminId,
  actions,
}: {
  resource: Resource;
  shopId?: string;
  adminId?: string;
  actions?: (row: DataRow) => React.ReactNode;
}) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [plan, setPlan] = useState("");
  const debouncedPlan = useDebounced(plan);
  const [sort, setSort] = useState("newest");
  const [range, setRange] = useState({ from: "", to: "" });
  const params = new URLSearchParams({
    page: String(page),
    limit: "20",
    sort,
    ...(q ? { q } : {}),
    ...(filter ? { status: filter } : {}),
    ...(debouncedPlan ? { plan: debouncedPlan } : {}),
    ...(shopId ? { shopId } : {}),
    ...(adminId ? { adminId } : {}),
    ...Object.fromEntries(Object.entries(range).filter(([, v]) => v)),
  });
  const query = useAdminQuery<DataRow[]>(`${resource}?${params}`);
  const waiting = q !== search || plan !== debouncedPlan;
  const total = query.data?.pagination?.total || 0;
  const pages = Math.max(1, Math.ceil(total / 20));
  return (
    <section className="a-card">
      <div className="a-toolbar">
        <div className="a-search">
          <Search />
          <input
            className="a-input"
            aria-label={`Search ${resource}`}
            placeholder={
              resource === "payments"
                ? "Search shop or gateway reference…"
                : resource === "administrators"
                  ? "Search email…"
                  : "Search records…"
            }
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {statuses[resource] && (
          <div className="a-filter">
            <label htmlFor={`status-${resource}`}>Status</label>
            <select
              id={`status-${resource}`}
              className="a-select"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {statuses[resource]!.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
        )}
        {["shops", "subscriptions"].includes(resource) && (
          <div className="a-filter">
            <label htmlFor={`plan-${resource}`}>Plan code</label>
            <input
              id={`plan-${resource}`}
              className="a-input"
              placeholder="All plans"
              value={plan}
              onChange={(e) => {
                setPlan(e.target.value);
                setPage(1);
              }}
            />
          </div>
        )}
        <div className="a-filter">
          <label htmlFor={`sort-${resource}`}>Sort</label>
          <select
            id={`sort-${resource}`}
            className="a-select"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            {resource === "shops" && <option value="name">Shop name</option>}
          </select>
        </div>
        {resource !== "administrators" && (
          <DateFilter
            {...range}
            onChange={(from, to) => {
              setRange({ from, to });
              setPage(1);
            }}
          />
        )}
        <Button
          variant="ghost"
          aria-label="Refresh records"
          busy={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={16} />
        </Button>
      </div>
      {query.isFetching && !query.isPending && (
        <div
          role="status"
          aria-label="Refreshing records"
          className="a-loading-line"
        />
      )}
      {query.isPending || waiting ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState
          message={query.error.message}
          retry={() => void query.refetch()}
        />
      ) : !query.data?.data.length ? (
        <Empty />
      ) : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                {columns[resource].map((c) => (
                  <th key={c.key} scope="col">
                    {c.label}
                  </th>
                ))}
                {actions && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((row) => (
                <tr key={String(row._id || row.id)}>
                  {columns[resource].map((c) => (
                    <td key={c.key}>
                      {c.render ? c.render(row) : String(row[c.key] ?? "—")}
                    </td>
                  ))}
                  {actions && <td>{actions(row)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="a-pagination">
        <span>
          {query.isPending || waiting
            ? "Loading records…"
            : `${total.toLocaleString()} records · Page ${page} of ${pages}`}
        </span>
        <div className="a-pagination-controls">
          <Button
            variant="outline"
            aria-label="Previous page"
            disabled={page === 1 || query.isFetching || waiting}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={15} />
            Previous
          </Button>
          <Button
            variant="outline"
            aria-label="Next page"
            disabled={page >= pages || query.isFetching || waiting}
            onClick={() => setPage(page + 1)}
          >
            Next
            <ChevronRight size={15} />
          </Button>
        </div>
      </div>
    </section>
  );
}
export function ResourcePage({
  resource,
}: {
  resource: "shops" | "subscriptions" | "payments" | "audit-logs";
}) {
  const title = {
    shops: "Shops",
    subscriptions: "Subscriptions",
    payments: "Payments",
    "audit-logs": "Audit logs",
  }[resource];
  const description = {
    shops: "Explore registered shops and their current subscription access.",
    subscriptions:
      "Review recorded entitlements without changing subscription rules.",
    payments:
      "Inspect gateway records. Only verified, captured amounts contribute to revenue.",
    "audit-logs":
      "An append-only record of administrator actions and security events.",
  }[resource];
  return (
    <>
      <div className="a-page-heading">
        <div>
          <div className="a-eyebrow">
            {resource === "audit-logs"
              ? "ACCOUNTABILITY"
              : "PLATFORM OPERATIONS"}
          </div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <Badge>Read-only</Badge>
      </div>
      {(resource === "subscriptions" || resource === "payments") && (
        <SubscriptionSummary payments={resource === "payments"} />
      )}
      <ResourceTable resource={resource} />
      {resource === "subscriptions" && (
        <p className="a-definition">
          Status filters use effective dates, including scheduled records that
          have started. The table shows stored status. Free-plan fallback access
          without a subscription record is not listed.
        </p>
      )}
    </>
  );
}
function SubscriptionSummary({ payments }: { payments: boolean }) {
  const query = useAdminQuery<Dashboard>("dashboard?");
  const d = query.data?.data;
  if (query.isPending) return <Skeleton rows={1} />;
  if (query.isError)
    return (
      <ErrorState
        message={query.error.message}
        retry={() => void query.refetch()}
      />
    );
  if (!d) return null;
  return payments ? (
    <div className="a-notice">
      <strong>Verified net revenue · last 30 days</strong>
      <div>
        {d.metrics.revenue.length
          ? d.metrics.revenue
              .map(
                (r) =>
                  `${money(r.amountMinor, r._id)} (${r.count} verified records)`,
              )
              .join(" · ")
          : "No verified revenue in this period."}
      </div>
      <Link href="/admin/reports">
        Open reports for date-filtered revenue →
      </Link>
    </div>
  ) : (
    <div className="a-plan-grid">
      {d.plans.map((plan) => (
        <div className="a-card" key={String(plan._id)}>
          <strong>{String(plan.name)}</strong>
          <p>
            {money(Number(plan.monthlyPriceMinor), String(plan.currency))} /
            month
          </p>
          <p className="a-muted">
            {plan.unlimitedCustomers
              ? "Unlimited customers"
              : `${plan.customerLimit} customers`}
          </p>
        </div>
      ))}
    </div>
  );
}
