"use client";
import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Store,
  Activity,
  CreditCard,
  CheckCheck,
  Clock3,
  CalendarX2,
  Wallet,
  UserPlus,
  ArrowUpRight,
  Download,
} from "lucide-react";
import { useAdminQuery } from "../../../hooks/admin/use-admin-query";
import { date, money } from "../../../lib/admin/api";
import type { Dashboard } from "../../../types/admin";
import { Skeleton, ErrorState, Badge, Empty, Button } from "../shared/ui";
import { DateFilter } from "../shared/date-filter";
const GrowthChart = dynamic(
  () => import("../charts/analytics-charts").then((m) => m.GrowthChart),
  { ssr: false, loading: () => <Skeleton rows={3} /> },
);
const DistributionChart = dynamic(
  () => import("../charts/analytics-charts").then((m) => m.DistributionChart),
  { ssr: false, loading: () => <Skeleton rows={3} /> },
);
const RevenueChart = dynamic(
  () => import("../charts/analytics-charts").then((m) => m.RevenueChart),
  { ssr: false, loading: () => <Skeleton rows={3} /> },
);
export function Overview({ report = false }: { report?: boolean }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const [currency, setCurrency] = useState("INR");
  const params = new URLSearchParams(
    Object.fromEntries(Object.entries(range).filter(([, value]) => value)),
  );
  const query = useAdminQuery<Dashboard>(
    `${report ? "reports" : "dashboard"}?${params}`,
  );
  const d = query.data?.data;
  return (
    <>
      <div className="a-page-heading">
        <div>
          <div className="a-eyebrow">PLATFORM INTELLIGENCE</div>
          <h1>{report ? "Reports & analytics" : "Platform overview"}</h1>
          <p>
            {report
              ? "Explore registrations, subscriptions, and verified revenue."
              : "A clear view of your shops, subscriptions, and platform growth."}
          </p>
        </div>
        <div className="a-inline-actions">
          <DateFilter
            {...range}
            onChange={(from, to) => setRange({ from, to })}
          />
          {report && (
            <Button variant="outline" asChild>
              <a href={`/admin/api/reports/export?${params}`}>
                <Download size={15} />
                Export CSV
              </a>
            </Button>
          )}
        </div>
      </div>
      {query.isPending ? (
        <Skeleton rows={8} />
      ) : query.isError ? (
        <ErrorState
          message={query.error.message}
          retry={() => void query.refetch()}
        />
      ) : d ? (
        <>
          {query.isFetching && <div className="a-loading-line" />}
          <div className="a-kpis">
            {[
              {
                label: "Registered shops",
                value: d.metrics.totalShops,
                icon: Store,
                note: "All registered shop profiles",
              },
              {
                label: "Active shops",
                value: d.metrics.activeShops,
                icon: Activity,
                note: "Linked owner account enabled",
              },
              {
                label: "Total subscriptions",
                value: d.metrics.totalSubscriptions,
                icon: CreditCard,
                note: "Persisted subscription records",
              },
              {
                label: "Active subscriptions",
                value: d.metrics.activeSubscriptions,
                icon: CheckCheck,
                note: "Currently effective records",
              },
              {
                label: "Expiring subscriptions",
                value: d.metrics.expiringSubscriptions,
                icon: Clock3,
                note: "Within the next 30 days",
              },
              {
                label: "Expired subscriptions",
                value: d.metrics.expiredSubscriptions,
                icon: CalendarX2,
                note: "Expired recorded entitlements",
              },
              {
                label: "Verified revenue",
                value: money(
                  d.metrics.revenue.find((r) => r._id === currency)
                    ?.amountMinor || 0,
                  currency,
                ),
                icon: Wallet,
                note: "Selected period · net of recorded refunds",
              },
              {
                label: "Recent registrations",
                value: d.metrics.recentRegistrations,
                icon: UserPlus,
                note: `${date(d.period.from)} – ${date(d.period.to)}`,
              },
            ].map((kpi) => (
              <article className="a-card a-kpi" key={kpi.label}>
                <div className="a-kpi-top">
                  {kpi.label}
                  <span className="a-kpi-icon">
                    <kpi.icon size={16} />
                  </span>
                </div>
                <strong>
                  {typeof kpi.value === "number"
                    ? kpi.value.toLocaleString("en-IN")
                    : kpi.value}
                </strong>
                <small>{kpi.note}</small>
              </article>
            ))}
          </div>
          <div className="a-charts">
            <section className="a-card">
              <div className="a-card-head">
                <div>
                  <h2>Shop registration growth</h2>
                  <p className="a-muted">New shops registered each day</p>
                </div>
                <Badge>UTC</Badge>
              </div>
              <GrowthChart data={d.registrations} label="Registrations" />
            </section>
            <section className="a-card">
              <div className="a-card-head">
                <div>
                  <h2>Plan distribution</h2>
                  <p className="a-muted">
                    Currently effective subscription records
                  </p>
                </div>
              </div>
              <DistributionChart data={d.distribution} />
            </section>
          </div>
          <div className="a-grid-2">
            <section className="a-card">
              <div className="a-card-head">
                <h2>Subscription growth</h2>
                <Badge>New records</Badge>
              </div>
              <GrowthChart
                data={d.subscriptionGrowth}
                label="Subscriptions"
                bar
              />
            </section>
            <section className="a-card">
              <div className="a-card-head">
                <h2>Verified revenue trend</h2>
                <select
                  className="a-select"
                  style={{ width: 90 }}
                  aria-label="Revenue currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {[
                    ...new Set(["INR", ...d.metrics.revenue.map((r) => r._id)]),
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <RevenueChart data={d.revenueTrend} currency={currency} />
            </section>
          </div>
          {!report && (
            <div className="a-grid-2">
              <section className="a-card">
                <div className="a-card-head">
                  <h2>Recent registrations</h2>
                  <Link href="/admin/shops" className="a-inline-actions">
                    View shops <ArrowUpRight size={15} />
                  </Link>
                </div>
                {d.recentShops.length ? (
                  <div className="a-list">
                    {d.recentShops.map((shop) => (
                      <Link
                        className="a-list-row"
                        href={`/admin/shops/${shop._id}`}
                        key={shop._id}
                      >
                        <div>
                          <strong>{String(shop.name || "Unnamed shop")}</strong>
                          <small>
                            {String(shop.owner || "Owner unavailable")}
                          </small>
                        </div>
                        <small>{date(shop.createdAt)}</small>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Empty title="No shop registrations yet" />
                )}
              </section>
              <section className="a-card">
                <div className="a-card-head">
                  <h2>Administrator activity</h2>
                  <Link href="/admin/audit-logs" className="a-inline-actions">
                    View audit log <ArrowUpRight size={15} />
                  </Link>
                </div>
                {d.recentAudit.length ? (
                  <div className="a-list">
                    {d.recentAudit.map((a) => (
                      <div className="a-list-row" key={a._id}>
                        <div>
                          <strong>
                            {String(a.action).replaceAll(".", " · ")}
                          </strong>
                          <small>{date(a.createdAt)}</small>
                        </div>
                        <Badge tone={String(a.result)}>
                          {String(a.result)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title="No administrative activity yet" />
                )}
              </section>
            </div>
          )}
          {report && (
            <section className="a-card">
              <div className="a-card-head">
                <h2>Report detail</h2>
                <Badge>Bounded to one year</Badge>
              </div>
              <ReportTable rows={d.registrations} />
            </section>
          )}
          <details className="a-definition">
            <summary>Metric definitions & data availability</summary>
            {Object.entries(d.definitions).map(([key, value]) => (
              <p key={key}>{value}</p>
            ))}
          </details>
        </>
      ) : null}
    </>
  );
}
function ReportTable({ rows }: { rows: Dashboard["registrations"] }) {
  const [page, setPage] = useState(1);
  const count = Math.max(1, Math.ceil(rows.length / 15));
  const current = Math.min(page, count);
  return (
    <>
      {rows.length ? (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Registration date (UTC)</th>
                <th>New shops</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice((current - 1) * 15, current * 15).map((row) => (
                <tr key={row._id}>
                  <td>{date(row._id)}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
      <div className="a-pagination">
        <span>{rows.length} daily aggregates</span>
        <div className="a-pagination-controls">
          <Button
            variant="outline"
            disabled={current === 1}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </Button>
          {current} / {count}
          <Button
            variant="outline"
            disabled={current === count}
            onClick={() => setPage(current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}
