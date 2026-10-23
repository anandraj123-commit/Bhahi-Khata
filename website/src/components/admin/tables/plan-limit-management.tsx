"use client";
import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useAdmin } from "../layout/shell";
import { useToast } from "../layout/providers";
import { useAdminQuery } from "../../../hooks/admin/use-admin-query";
import { useClock } from "../../../hooks/admin/use-clock";
import { adminRequest, money } from "../../../lib/admin/api";
import { Badge, Button, Empty, ErrorState, Modal, Skeleton } from "../shared/ui";

type Duration = {
  months: number;
  durationMonths: number;
  basePriceMinor: number;
  discountPercent: number;
  discountAmountMinor: number;
  taxableAmountMinor: number;
  taxPercent: number;
  taxAmountMinor: number;
  finalAmountMinor: number;
  isActive: boolean;
};
type Plan = {
  _id: string;
  id: string;
  name: string;
  code: "free" | "pro" | "business";
  description: string;
  monthlyPriceMinor: number;
  currency: "INR";
  customerLimit: number | null;
  unlimitedCustomers: boolean;
  entitlements: Record<string, string | number | boolean | null>;
  features: string[];
  enabled: boolean;
  displayOrder: number;
  configurationVersion: number;
  pricingVersion: number;
  durations: Duration[];
};
type DurationDraft = { months: number; basePrice: string; discountPercent: string; taxPercent: string; isActive: boolean };
type Draft = {
  name: string;
  description: string;
  customerLimit: string;
  unlimitedCustomers: boolean;
  entitlements: string;
  features: string;
  enabled: boolean;
  displayOrder: string;
  durations: DurationDraft[];
};
const DURATION_NAMES: Record<number, string> = { 1: "Monthly", 3: "Quarterly", 6: "Half-yearly", 12: "Yearly" };
const durationName = (months: number) => DURATION_NAMES[months] || `${months} months`;
const priceFromMinor = (minor: number) => (minor / 100).toFixed(2);
function draftFrom(plan: Plan): Draft {
  return {
    name: plan.name,
    description: plan.description || "",
    customerLimit: plan.customerLimit == null ? "" : String(plan.customerLimit),
    unlimitedCustomers: plan.unlimitedCustomers,
    entitlements: JSON.stringify(plan.entitlements || {}, null, 2),
    features: (plan.features || []).join("\n"),
    enabled: plan.enabled,
    displayOrder: String(plan.displayOrder || 0),
    durations: (plan.durations || []).map((item) => ({
      months: item.months,
      basePrice: priceFromMinor(item.basePriceMinor),
      discountPercent: String(item.discountPercent),
      taxPercent: String(item.taxPercent),
      isActive: item.isActive,
    })),
  };
}
function parseRupees(value: string) {
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) return null;
  const [rupees, paise = ""] = text.split(".");
  const minor = Number(rupees) * 100 + Number(paise.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}
function parsePercent(value: string) {
  if (!/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}
function preview(duration: DurationDraft) {
  const base = parseRupees(duration.basePrice);
  const discountPercent = parsePercent(duration.discountPercent);
  const taxPercent = parsePercent(duration.taxPercent);
  if (base == null || discountPercent == null || taxPercent == null) return null;
  const discount = Number((BigInt(base) * BigInt(Math.round(discountPercent * 100)) + BigInt(5000)) / BigInt(10000));
  const taxable = base - discount;
  const tax = Number((BigInt(taxable) * BigInt(Math.round(taxPercent * 100)) + BigInt(5000)) / BigInt(10000));
  return { discount, taxable, tax, total: taxable + tax };
}

export function PlanLimitManagement() {
  const query = useAdminQuery<Plan[]>("plans");
  const { permissions, csrfToken, reauthenticatedAt } = useAdmin();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Plan | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = useClock();
  const canManage = permissions.includes("plans:manage");
  const verifiedUntil = reauthenticatedAt ? Date.parse(reauthenticatedAt) + 5 * 60_000 : 0;
  const verified = now > 0 && Number.isFinite(verifiedUntil) && verifiedUntil > now;
  const verificationLoading = now === 0;

  const beginEdit = (plan: Plan) => {
    setSelected(plan);
    setDraft(draftFrom(plan));
    setError("");
  };
  const close = (open: boolean) => {
    if (!busy && !open) {
      setSelected(null);
      setDraft(null);
      setError("");
    }
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !draft || busy) return;
    if (!draft.customerLimit.trim() && !draft.unlimitedCustomers) {
      setError("Enter a positive whole-number customer limit or select Unlimited.");
      return;
    }
    const customerLimit = draft.unlimitedCustomers ? null : Number(draft.customerLimit);
    if (!draft.unlimitedCustomers && (!Number.isSafeInteger(customerLimit) || Number(customerLimit) <= 0)) {
      setError("Customer limit must be a positive whole number.");
      return;
    }
    let entitlements: unknown;
    try { entitlements = JSON.parse(draft.entitlements || "{}"); }
    catch { setError("Entitlements must be valid JSON."); return; }
    if (!entitlements || typeof entitlements !== "object" || Array.isArray(entitlements)) {
      setError("Entitlements must be a JSON object.");
      return;
    }
    let durations: { months: number; basePriceMinor: number; discountPercent: number; taxPercent: number; isActive: boolean }[];
    try {
      durations = selected.code === "free" ? [] : draft.durations.map((duration) => {
        const basePriceMinor = parseRupees(duration.basePrice);
        const discountPercent = parsePercent(duration.discountPercent);
        const taxPercent = parsePercent(duration.taxPercent);
        if (basePriceMinor == null || discountPercent == null || taxPercent == null)
          throw new Error(`Enter valid price, discount and tax values for ${durationName(duration.months)}.`);
        return { months: duration.months, basePriceMinor, discountPercent, taxPercent, isActive: duration.isActive };
      });
    } catch (priceError) {
      setError(priceError instanceof Error ? priceError.message : "Enter valid duration pricing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await adminRequest<Plan>(`plans/${selected._id}`, {
        method: "PATCH",
        csrf: csrfToken,
        body: {
          expectedVersion: selected.configurationVersion || 1,
          name: draft.name.trim(),
          description: draft.description.trim(),
          customerLimit,
          unlimitedCustomers: draft.unlimitedCustomers,
          features: draft.features.split("\n").map((item) => item.trim()).filter(Boolean),
          entitlements,
          enabled: selected.code === "free" ? true : draft.enabled,
          displayOrder: Number(draft.displayOrder),
          durations,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["admin", "plans"] });
      toast(`${selected.name} plan settings saved.`);
      setSelected(null);
      setDraft(null);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Could not save plan settings.";
      setError(message);
      toast(message, true);
    } finally { setBusy(false); }
  };

  if (query.isPending) return <Skeleton rows={3} />;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  const plans = (query.data?.data || []).slice().sort((a, b) => a.displayOrder - b.displayOrder);
  if (!plans.length) return <Empty title="No canonical subscription plans found" />;

  return (
    <>
      <div className="a-plan-grid">
        {plans.map((plan) => (
          <section className="a-card" key={plan._id}>
            <div className="a-card-head">
              <div><h2>{plan.name}</h2><p>{plan.code}</p></div>
              <Badge tone={plan.enabled ? "enabled" : "disabled"}>{plan.enabled ? "Active" : "Inactive"}</Badge>
            </div>
            <div className="a-card-body">
              <strong>{plan.code === "free" ? "₹0 · No payment required" : `${money(plan.monthlyPriceMinor, "INR")} monthly base`}</strong>
              <p className="a-muted">{plan.unlimitedCustomers || plan.customerLimit == null ? "Unlimited customers" : `${plan.customerLimit.toLocaleString()} customers`}</p>
              <p className="a-muted">{plan.description}</p>
              {(plan.features || []).map((feature) => <p className="a-muted" key={feature}>• {feature}</p>)}
              {plan.code === "free" ? <Badge tone="enabled">Required fallback · cannot be disabled</Badge> : (
                <div style={{ overflowX: "auto", marginTop: 12 }}>
                  <table className="a-table"><thead><tr><th>Duration</th><th>Base</th><th>Discount</th><th>Tax</th><th>Total</th><th>Status</th></tr></thead>
                    <tbody>{plan.durations.slice().sort((a, b) => a.months - b.months).map((duration) => (
                      <tr key={duration.months}>
                        <td>{durationName(duration.months)}</td>
                        <td>{money(duration.basePriceMinor, "INR")}</td>
                        <td>{duration.discountPercent}% · −{money(duration.discountAmountMinor, "INR")}</td>
                        <td>{duration.taxPercent}% · {money(duration.taxAmountMinor, "INR")}</td>
                        <td><strong>{money(duration.finalAmountMinor, "INR")}</strong></td>
                        <td><Badge tone={duration.isActive ? "enabled" : "disabled"}>{duration.isActive ? "Active" : "Inactive"}</Badge></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <Button type="button" variant="outline" disabled={!canManage || verificationLoading || !verified} onClick={() => beginEdit(plan)}>
                Edit plan and pricing
              </Button>
              {!canManage && <small role="status">Your administrator role does not have permission to manage plan configuration.</small>}
              {canManage && verificationLoading && <small role="status">Checking identity verification…</small>}
              {canManage && !verificationLoading && !verified && reauthenticatedAt && <small role="status">Your identity verification has expired. Please confirm your identity again in <Link href="/admin/settings">Settings</Link>.</small>}
              {canManage && !verificationLoading && !verified && !reauthenticatedAt && <small role="status">Confirm your identity in <Link href="/admin/settings">Settings</Link> to edit subscription plans and pricing.</small>}
            </div>
          </section>
        ))}
      </div>
      <Modal title={selected ? `Edit ${selected.name} plan` : "Edit subscription plan"} description="Pricing is recalculated and validated by the backend. Existing purchases retain their saved terms." open={Boolean(selected && draft)} onOpenChange={close}>
        {selected && draft && (
          <form onSubmit={(event) => { try { void save(event); } catch (formError) { setError(formError instanceof Error ? formError.message : "Invalid plan configuration."); } }} className="a-card-body" style={{ padding: "20px 0 0", maxHeight: "70vh", overflowY: "auto" }}>
            <label className="a-field"><span>Plan code</span><input className="a-input" value={selected.code} readOnly /></label>
            <label className="a-field"><span>Display name</span><input className="a-input" maxLength={80} value={draft.name} disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label className="a-field"><span>Description</span><textarea className="a-input" maxLength={500} value={draft.description} disabled={busy} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <div className="a-field"><span>Customer allowance</span><div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input className="a-input" type="number" min="1" step="1" value={draft.unlimitedCustomers ? "" : draft.customerLimit} disabled={busy || draft.unlimitedCustomers} onChange={(event) => setDraft({ ...draft, customerLimit: event.target.value })} placeholder="Positive whole number" />
              <label><input type="checkbox" checked={draft.unlimitedCustomers} disabled={busy} onChange={(event) => setDraft({ ...draft, unlimitedCustomers: event.target.checked })} /> Unlimited</label>
            </div></div>
            <label className="a-field"><span>Plan benefits (one per line)</span><textarea className="a-input" value={draft.features} disabled={busy} onChange={(event) => setDraft({ ...draft, features: event.target.value })} /></label>
            <label className="a-field"><span>Entitlements (JSON object)</span><textarea className="a-input" rows={5} value={draft.entitlements} disabled={busy} onChange={(event) => setDraft({ ...draft, entitlements: event.target.value })} /></label>
            <label className="a-field"><span>Display order</span><input className="a-input" type="number" min="0" max="1000" step="1" value={draft.displayOrder} disabled={busy} onChange={(event) => setDraft({ ...draft, displayOrder: event.target.value })} /></label>
            {selected.code !== "free" && <label><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Plan available for new purchases</label>}
            {selected.code === "free" ? <p className="a-definition">Free remains active at ₹0 as the permanent fallback. No Cashfree payment is created.</p> : <>
              <div style={{ overflowX: "auto" }}><table className="a-table"><thead><tr><th>Duration</th><th>Base price (₹)</th><th>Discount %</th><th>Tax %</th><th>Discount</th><th>Tax</th><th>Final payable</th><th>Active</th></tr></thead>
                <tbody>{draft.durations.slice().sort((a, b) => a.months - b.months).map((duration) => {
                  const amounts = preview(duration);
                  const setDuration = (field: keyof DurationDraft, value: string | boolean) => setDraft({ ...draft, durations: draft.durations.map((item) => item.months === duration.months ? { ...item, [field]: value } : item) });
                  return <tr key={duration.months}>
                    <td>{durationName(duration.months)}</td>
                    <td><input className="a-input" type="number" min="0.01" step="0.01" aria-label={`${durationName(duration.months)} base price in rupees`} value={duration.basePrice} disabled={busy} onChange={(event) => setDuration("basePrice", event.target.value)} /></td>
                    <td><input className="a-input" type="number" min="0" max="100" step="0.01" aria-label={`${durationName(duration.months)} discount percentage`} value={duration.discountPercent} disabled={busy} onChange={(event) => setDuration("discountPercent", event.target.value)} /></td>
                    <td><input className="a-input" type="number" min="0" max="100" step="0.01" aria-label={`${durationName(duration.months)} tax percentage`} value={duration.taxPercent} disabled={busy} onChange={(event) => setDuration("taxPercent", event.target.value)} /></td>
                    <td>{amounts ? money(amounts.discount, "INR") : "—"}</td><td>{amounts ? money(amounts.tax, "INR") : "—"}</td><td><strong>{amounts ? money(amounts.total, "INR") : "—"}</strong></td>
                    <td><input type="checkbox" aria-label={`${durationName(duration.months)} duration active`} checked={duration.isActive} disabled={busy} onChange={(event) => setDuration("isActive", event.target.checked)} /></td>
                  </tr>;
                })}</tbody></table></div>
              <p className="a-definition">New paid-duration configuration defaults to 0% discount and 0% tax. A zero tax setting is only a configuration default, not a tax exemption or legal determination.</p>
            </>}
            {error && <p role="alert" className="a-field-error">{error}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <Button type="button" variant="outline" disabled={busy} onClick={() => close(false)}>Cancel</Button>
              <Button type="submit" busy={busy}>Save Changes</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
