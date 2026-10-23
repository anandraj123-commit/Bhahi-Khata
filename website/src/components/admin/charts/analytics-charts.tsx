"use client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Dashboard, Series } from "../../../types/admin";
import { Empty } from "../shared/ui";
const palette = ["#158467", "#56aa96", "#95c7b9", "#7286b8", "#bdab77"];
export function GrowthChart({
  data,
  label,
  bar = false,
}: {
  data: Series;
  label: string;
  bar?: boolean;
}) {
  if (!data.length)
    return (
      <Empty
        title="No records in this period"
        message="Choose another date range to explore platform growth."
      />
    );
  return (
    <div className="a-chart" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        {bar ? (
          <BarChart data={data}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="_id"
              tickFormatter={(v) => String(v).slice(5)}
              minTickGap={30}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip />
            <Bar
              name={label}
              dataKey="count"
              fill="#158467"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        ) : (
          <AreaChart data={data}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="_id"
              tickFormatter={(v) => String(v).slice(5)}
              minTickGap={30}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip />
            <Area
              name={label}
              dataKey="count"
              type="monotone"
              stroke="#158467"
              fill="#158467"
              fillOpacity={0.09}
              strokeWidth={2.5}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
export function DistributionChart({ data }: { data: Series }) {
  if (!data.length)
    return (
      <Empty
        title="No active subscription records"
        message="Implicit Free-plan access is not a stored subscription record."
      />
    );
  return (
    <>
      <div
        className="a-chart"
        role="img"
        aria-label="Active subscription records by plan"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              nameKey="_id"
              dataKey="count"
              innerRadius="58%"
              outerRadius="83%"
              paddingAngle={4}
              stroke="none"
            >
              {data.map((row, i) => (
                <Cell key={row._id} fill={palette[i % palette.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="a-legend">
        {data.map((row, i) => (
          <span key={row._id}>
            <i style={{ background: palette[i % palette.length] }} />
            {row._id} · {row.count}
          </span>
        ))}
      </div>
    </>
  );
}
export function RevenueChart({
  data,
  currency,
}: {
  data: Dashboard["revenueTrend"];
  currency: string;
}) {
  const rows = data
    .filter((r) => r._id.currency === currency)
    .map((r) => ({ _id: r._id.date, count: r.amountMinor / 100 }));
  return (
    <GrowthChart data={rows} label={`Verified net revenue (${currency})`} />
  );
}
