"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Filter, RotateCcw, Search, X } from "lucide-react";
import { Button } from "../shared/ui";
import {
  useAdminQuery,
  useDebounced,
} from "../../../hooks/admin/use-admin-query";
import { money } from "../../../lib/admin/api";

type Options = readonly (readonly [string, string])[];
const types: Options = [
  ["credit", "Udhari"],
  ["payment", "Payment Received"],
  ["refund", "Advance Refunded"],
];
const dates: Options = [
  ["date", "Transaction Date"],
  ["createdAt", "Created At"],
  ["updatedAt", "Updated At"],
];
const presets: Options = [
  ["", "All Dates"],
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7", "Last 7 Days"],
  ["30", "Last 30 Days"],
  ["month", "This Month"],
  ["lastMonth", "Last Month"],
  ["custom", "Custom Range"],
];
const labels: Record<string, string> = {
  q: "Search",
  shopId: "Shop",
  shopName: "Shop name",
  shopPhone: "Shop mobile",
  name: "Customer",
  phone: "Customer mobile",
  address: "Address",
  customerId: "Customer ID",
  clientId: "Transaction ID",
  method: "Payment method",
  type: "Type",
  customerStatus: "Customer status",
  archived: "Subscription archive",
  transactionStatus: "Record status",
  hasNotes: "Notes",
  edited: "Server revision",
};
const human: Record<string, string> = {
  credit: "Udhari",
  payment: "Payment Received",
  refund: "Advance Refunded",
  conflict_resolved: "Conflict resolved",
  recorded: "Recorded",
  active: "Active",
  disabled: "Disabled",
  removed: "Removed",
  invalid: "Requires review",
};
export function validateTransactionRanges(p: URLSearchParams) {
  const errors: string[] = [];
  for (const [key, label] of dates) {
    const from = p.get(key + "From"),
      to = p.get(key + "To");
    if (from && to && from > to)
      errors.push(`${label}: end date must be on or after start date.`);
    for (const value of [from, to])
      if (
        value &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        errors.push(`${label}: enter a valid date.`);
  }
  const min = p.get("amountMin"),
    max = p.get("amountMax");
  if (
    [min, max].some(
      (v) =>
        v !== null &&
        (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 1e12),
    )
  )
    errors.push("Amounts must be between ₹0 and ₹1,000,000,000,000.");
  if (min !== null && max !== null && Number(min) > Number(max))
    errors.push("Maximum amount must be at least the minimum amount.");
  return errors;
}
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Options;
}) {
  return (
    <label className="a-filter-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
type Shop = { id: string; name: string };
export function ShopSelect({
  value,
  onChange,
  onLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onLabel: (s: Shop) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [text, setText] = useState(""),
    [open, setOpen] = useState(false);
  const q = useDebounced(text, 300);
  const result = useAdminQuery<Shop[]>(
    `customer-shops?limit=50&q=${encodeURIComponent(q.trim())}`,
    open,
  );
  const selected = useAdminQuery<Shop[]>(
    `customer-shops?limit=50&q=${encodeURIComponent(value)}`,
    Boolean(value),
  );
  const shop = selected.data?.data.find((s) => s.id === value);
  useEffect(() => {
    if (shop) onLabel(shop);
  }, [shop, onLabel]);
  const choose = (s: Shop) => {
    onChange(s.id);
    onLabel(s);
    if (ref.current) {
      ref.current.open = false;
      ref.current.querySelector("summary")?.focus();
    }
  };
  return (
    <div className="a-filter-field">
      <span id="ledger-shop-label">Shop</span>
      <details
        ref={ref}
        className="a-shop-picker"
        onToggle={(e) => setOpen(e.currentTarget.open)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && ref.current) {
            ref.current.open = false;
            ref.current.querySelector("summary")?.focus();
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node) && ref.current)
            ref.current.open = false;
        }}
      >
        <summary aria-labelledby="ledger-shop-label ledger-shop-value">
          <span id="ledger-shop-value">
            {shop?.name || value || "All Shops"}
          </span>
          <ChevronDown size={16} />
        </summary>
        <div className="a-shop-picker-menu">
          <input
            autoComplete="off"
            type="search"
            aria-label="Search shops by name, ID or mobile"
            placeholder="Name, ID or mobile…"
            maxLength={100}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="a-shop-picker-results">
            <button
              type="button"
              onClick={() => choose({ id: "", name: "All Shops" })}
            >
              All Shops
            </button>
            {result.isFetching ? (
              <p role="status">Searching shops…</p>
            ) : result.error ? (
              <div role="alert">
                <p>Unable to retrieve shops.</p>
                <Button variant="ghost" onClick={() => void result.refetch()}>
                  Retry
                </Button>
              </div>
            ) : !result.data?.data.length ? (
              <p>No matching shops.</p>
            ) : (
              result.data.data.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  aria-pressed={s.id === value}
                  onClick={() => choose(s)}
                >
                  <strong>{s.name || "Registered shop"}</strong>
                  <small>{s.id}</small>
                </button>
              ))
            )}
          </div>
          <small>
            Up to 50 matches. Refine your search for more specific results.
          </small>
        </div>
      </details>
    </div>
  );
}
function range(preset: string) {
  const n = new Date(),
    today = new Date(
      Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()),
    );
  let from = new Date(today),
    to = new Date(today);
  if (preset === "yesterday") {
    from.setUTCDate(from.getUTCDate() - 1);
    to = new Date(from);
  }
  if (["7", "30"].includes(preset))
    from.setUTCDate(from.getUTCDate() - Number(preset) + 1);
  if (preset === "month") from.setUTCDate(1);
  if (preset === "lastMonth") {
    from = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1));
    to = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0));
  }
  return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)];
}
export function TransactionFilters({
  value,
  onChange,
  errors,
}: {
  value: string;
  onChange: (v: string) => void;
  errors: string[];
}) {
  const p = new URLSearchParams(value);
  const [expanded, setExpanded] = useState(false),
    [field, setField] = useState("date"),
    [custom, setCustom] = useState(false),
    [customMethod, setCustomMethod] = useState(false);
  const [shop, setShop] = useState<Shop | null>(null);
  const change = (values: Record<string, string>) => {
    const next = new URLSearchParams(value);
    for (const [k, v] of Object.entries(values)) {
      if (v.trim()) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    onChange(next.toString());
  };
  const reset = () => {
    const next = new URLSearchParams();
    for (const k of ["sort", "direction", "limit"])
      if (p.has(k)) next.set(k, p.get(k)!);
    onChange(next.toString());
    setCustom(false);
    setCustomMethod(false);
  };
  const input = (key: string, label: string, type = "text") => (
    <label className="a-filter-field" key={key}>
      <span>{label}</span>
      <input
        type={type}
        value={p.get(key) || ""}
        onChange={(e) => change({ [key]: e.target.value })}
        {...(type === "number"
          ? { min: 0, max: 1e12, step: "0.01", inputMode: "decimal" as const }
          : { maxLength: 100 })}
      />
    </label>
  );
  const select = (
    key: string,
    label: string,
    options: Options,
    defaultValue = "",
  ) => (
    <FilterSelect
      label={label}
      value={p.get(key) || defaultValue}
      options={options}
      onChange={(v) => change({ [key]: v })}
    />
  );
  const from = p.get(field + "From") || "",
    to = p.get(field + "To") || "";
  const inferred = presets.find(
    ([v]) => v && v !== "custom" && range(v)[0] === from && range(v)[1] === to,
  )?.[0];
  const preset = custom ? "custom" : from || to ? inferred || "custom" : "";
  const setPreset = (v: string) => {
    setCustom(v === "custom");
    if (v === "custom") {
      setExpanded(true);
      return;
    }
    const [start, end] = v ? range(v) : ["", ""];
    change({ [field + "From"]: start, [field + "To"]: end });
  };
  const chips: { label: string; keys: string[] }[] = [];
  for (const [key, v] of p.entries()) {
    if (
      ["page", "limit", "sort", "direction", "amountMin", "amountMax"].includes(
        key,
      ) ||
      dates.some(([d]) => key === d + "From" || key === d + "To")
    )
      continue;
    let text = human[v] || v;
    if (key === "shopId" && shop?.id === v) text = shop.name;
    if (["archived", "hasNotes", "edited"].includes(key))
      text =
        key === "archived"
          ? v === "true"
            ? "Archived"
            : "Not archived"
          : key === "hasNotes"
            ? v === "true"
              ? "With notes"
              : "Without notes"
            : v === "true"
              ? "Version > 1"
              : "Initial version";
    chips.push({ label: `${labels[key] || key}: ${text}`, keys: [key] });
  }
  for (const [key, label] of dates) {
    const a = p.get(key + "From"),
      b = p.get(key + "To");
    if (a || b) {
      const name = presets.find(
        ([v]) => v && v !== "custom" && range(v)[0] === a && range(v)[1] === b,
      )?.[1];
      chips.push({
        label: `${label}: ${name || `${a || "Any"} – ${b || "Any"}`}`,
        keys: [key + "From", key + "To"],
      });
    }
  }
  if (p.has("amountMin") || p.has("amountMax"))
    chips.push({
      label: `Amount: ${p.has("amountMin") ? money(Number(p.get("amountMin")) * 100) : "Any"} – ${p.has("amountMax") ? money(Number(p.get("amountMax")) * 100) : "Any"}`,
      keys: ["amountMin", "amountMax"],
    });
  const methods = ["Cash", "UPI", "Bank", "Other"];
  const method = p.get("method") || "";
  const isCustom = customMethod || Boolean(method && !methods.includes(method));
  return (
    <section
      className="a-card a-transaction-filters"
      aria-label="Transaction filters"
    >
      <div className="a-filter-toolbar">
        <label className="a-filter-field a-filter-global">
          <span>Global Search</span>
          <div>
            <Search size={17} />
            <input
              type="search"
              maxLength={100}
              value={p.get("q") || ""}
              onChange={(e) => change({ q: e.target.value })}
              placeholder="Transaction, shop, customer or notes"
            />
          </div>
        </label>
        <ShopSelect
          value={p.get("shopId") || ""}
          onChange={(v) => change({ shopId: v })}
          onLabel={setShop}
        />
        {select("type", "Transaction Type", [["", "All Types"], ...types])}
        <FilterSelect
          label={`Date Range · ${dates.find(([k]) => k === field)?.[1]}`}
          value={preset}
          options={presets}
          onChange={setPreset}
        />
        <Button
          variant="outline"
          aria-expanded={expanded}
          aria-controls="transaction-advanced-filters"
          onClick={() => setExpanded(!expanded)}
        >
          <Filter size={16} />
          Advanced Filters{" "}
          {chips.length > 0 && (
            <span className="a-filter-count">{chips.length}</span>
          )}
        </Button>
        <Button variant="ghost" onClick={reset}>
          <RotateCcw size={16} />
          Reset Filters
        </Button>
      </div>
      {chips.length > 0 && (
        <div className="a-filter-chips" aria-label="Active filters">
          {chips.map((c) => (
            <button
              type="button"
              key={c.keys.join(",")}
              onClick={() =>
                change(Object.fromEntries(c.keys.map((k) => [k, ""])))
              }
              aria-label={`Remove ${c.label}`}
            >
              {c.label}
              <X size={13} />
            </button>
          ))}
          <Button variant="ghost" onClick={reset}>
            Clear All Filters
          </Button>
        </div>
      )}
      {errors.length > 0 && (
        <div className="a-filter-validation" role="alert">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
          <p>
            Correct these values to update results. No invalid range is sent to
            the server.
          </p>
        </div>
      )}
      {expanded && (
        <div id="transaction-advanced-filters" className="a-filter-groups">
          <fieldset>
            <legend>Customer Filters</legend>
            <div className="a-filter-grid">
              {input("name", "Customer Name")}
              {input("phone", "Customer Mobile", "tel")}
              {input("address", "Customer Address")}
              {input("customerId", "Customer ID")}
              {select("customerStatus", "Customer Status", [
                ["", "All statuses"],
                ["active", "Active"],
                ["disabled", "Disabled"],
                ["removed", "Removed"],
                ["invalid", "Requires review"],
              ])}
              {select("archived", "Subscription Archive", [
                ["", "All customers"],
                ["true", "Archived"],
                ["false", "Not archived"],
              ])}
            </div>
          </fieldset>
          <fieldset>
            <legend>Transaction Filters</legend>
            <div className="a-filter-grid">
              {input("clientId", "Exact Transaction ID")}
              <FilterSelect
                label="Payment Method"
                value={isCustom ? "__custom" : method}
                options={[
                  ["", "All Methods"],
                  ...methods.map((v) => [v, v] as const),
                  ["__custom", "Custom stored method…"],
                ]}
                onChange={(v) => {
                  setCustomMethod(v === "__custom");
                  if (v !== "__custom") change({ method: v });
                }}
              />
              {isCustom && input("method", "Exact stored payment method")}
              {select("transactionStatus", "Transaction Status", [
                ["", "All statuses"],
                ["recorded", "Recorded"],
                ["conflict_resolved", "Conflict resolved"],
              ])}
              {input("amountMin", "Minimum Amount (₹)", "number")}
              {input("amountMax", "Maximum Amount (₹)", "number")}
              {select("hasNotes", "Notes", [
                ["", "All records"],
                ["true", "With notes"],
                ["false", "Without notes"],
              ])}
              {select("edited", "Server Revision", [
                ["", "All revisions"],
                ["true", "Version greater than 1"],
                ["false", "Initial version"],
              ])}
            </div>
          </fieldset>
          <fieldset>
            <legend>
              Date Filters <small>UTC · inclusive end date</small>
            </legend>
            <div className="a-filter-grid">
              <FilterSelect
                label="Date Field"
                value={field}
                options={dates}
                onChange={(v) => {
                  setField(v);
                  setCustom(false);
                }}
              />
              <FilterSelect
                label="Date Preset"
                value={preset}
                options={presets}
                onChange={setPreset}
              />
              {preset === "custom" && (
                <>
                  {input(field + "From", "Start Date", "date")}
                  {input(field + "To", "End Date", "date")}
                </>
              )}
            </div>
            <p className="a-muted">
              Each date field keeps its own range. Switch fields to combine
              ranges; remove them using the chips above.
            </p>
          </fieldset>
          <fieldset>
            <legend>Sorting & Display</legend>
            <div className="a-filter-grid">
              {select(
                "sort",
                "Sort By",
                [
                  ["date", "Transaction Date"],
                  ["createdAt", "Created At"],
                  ["updatedAt", "Updated At"],
                  ["amountPaise", "Amount"],
                  ["type", "Transaction Type"],
                  ["shop.name", "Shop Name"],
                  ["name", "Customer Name"],
                ],
                "date",
              )}
              {select(
                "direction",
                "Sort Direction",
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
                  ["20", "20 records"],
                  ["50", "50 records"],
                  ["100", "100 records"],
                ],
                "20",
              )}
            </div>
          </fieldset>
          <fieldset>
            <legend>Additional Shop Filters</legend>
            <div className="a-filter-grid">
              {input("shopId", "Exact Shop ID")}
              {input("shopName", "Shop Name Contains")}
              {input("shopPhone", "Shop Mobile", "tel")}
            </div>
          </fieldset>
        </div>
      )}
    </section>
  );
}
