"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Gift, Users, Wallet } from "lucide-react";
import { useAdmin } from "../layout/shell";
import { useToast } from "../layout/providers";
import { useAdminQuery } from "../../../hooks/admin/use-admin-query";
import { useClock } from "../../../hooks/admin/use-clock";
import { adminRequest, money } from "../../../lib/admin/api";
import { Button, ErrorState, Skeleton } from "../shared/ui";

type Settings = {
  enabled: boolean;
  referrerRewardAmountMinor: number;
  referredRewardAmountMinor: number;
  minimumCustomers: number;
  revision: number;
};
type Draft = {
  enabled: boolean;
  referrerRewardRupees: string;
  referredRewardRupees: string;
  minimumCustomers: string;
};
const draftFrom = (settings: Settings): Draft => ({
  enabled: settings.enabled,
  referrerRewardRupees: (settings.referrerRewardAmountMinor / 100).toFixed(2),
  referredRewardRupees: (settings.referredRewardAmountMinor / 100).toFixed(2),
  minimumCustomers: String(settings.minimumCustomers),
});
function parseRupees(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [rupees, paise = ""] = value.trim().split(".");
  const result = Number(rupees) * 100 + Number(paise.padEnd(2, "0"));
  return Number.isSafeInteger(result) && result > 0 && result <= 100000000 ? result : null;
}

export function ReferralSettings() {
  const query = useAdminQuery<Settings>("referrals/settings");
  if (query.isLoading) return <Skeleton />;
  if (query.isError || !query.data?.data)
    return <ErrorState message="Refer & Earn settings could not be loaded." retry={() => void query.refetch()} />;
  return <ReferralSettingsEditor settings={query.data.data} />;
}

function ReferralSettingsEditor({ settings }: { settings: Settings }) {
  const { permissions, csrfToken, reauthenticatedAt } = useAdmin();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(settings));
  const [savedRevision, setSavedRevision] = useState(settings.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = useClock();
  const canManage = permissions.includes("referrals:manage");
  const verificationExpiry = reauthenticatedAt ? Date.parse(reauthenticatedAt) + 5 * 60_000 : 0;
  const verified = now > 0 && Number.isFinite(verificationExpiry) && verificationExpiry > now;
  const dirty = useMemo(() => {
    return draft.enabled !== settings.enabled ||
      parseRupees(draft.referrerRewardRupees) !== settings.referrerRewardAmountMinor ||
      parseRupees(draft.referredRewardRupees) !== settings.referredRewardAmountMinor ||
      Number(draft.minimumCustomers) !== settings.minimumCustomers;
  }, [draft, settings]);

  const save = async () => {
    const referrerRewardAmountMinor = parseRupees(draft.referrerRewardRupees);
    const referredRewardAmountMinor = parseRupees(draft.referredRewardRupees);
    const minimumCustomers = Number(draft.minimumCustomers);
    if (!referrerRewardAmountMinor) return setError("Enter a valid positive reward for the referring shop.");
    if (!referredRewardAmountMinor) return setError("Enter a valid positive reward for the new shop.");
    if (!Number.isSafeInteger(minimumCustomers) || minimumCustomers < 1 || minimumCustomers > 50000)
      return setError("Minimum customers must be a whole number from 1 to 50,000.");
    setError("");
    setBusy(true);
    try {
      const result = await adminRequest<Settings>("referrals/settings", {
        method: "PATCH",
        csrf: csrfToken,
        body: {
          expectedVersion: savedRevision,
          enabled: draft.enabled,
          referrerRewardAmountMinor,
          referredRewardAmountMinor,
          minimumCustomers,
        },
      });
      setDraft(draftFrom(result.data));
      setSavedRevision(result.data.revision);
      queryClient.setQueryData(["admin", "referrals/settings"], { data: result.data });
      await queryClient.invalidateQueries({ queryKey: ["admin", "referrals/settings"] });
      toast("Refer & Earn settings saved.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save Refer & Earn settings.";
      setError(message);
      toast(message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="a-page-content">
      <div className="a-page-heading"><div><p className="a-eyebrow">GROWTH PROGRAM</p><h1>Refer &amp; Earn</h1><p>Configure shopkeeper referral rewards and qualification.</p></div></div>
      <div className="a-card">
        <div className="a-card-head"><div><h2>Program settings</h2><p>Settings are snapshotted when a new shop registers with a referral code.</p></div></div>
        <div className="a-card-body a-form-grid">
          <label className="a-field a-field-inline"><span><Gift size={18} /> Program status</span><select value={draft.enabled ? "enabled" : "disabled"} onChange={(event) => setDraft({ ...draft, enabled: event.target.value === "enabled" })}><option value="disabled">Disabled</option><option value="enabled">Enabled</option></select></label>
          <label className="a-field"><span><Wallet size={18} /> Reward for the referring shop (₹)</span><input inputMode="decimal" value={draft.referrerRewardRupees} onChange={(event) => setDraft({ ...draft, referrerRewardRupees: event.target.value })} placeholder="100.00" /></label>
          <label className="a-field"><span><Gift size={18} /> Reward for the new shop (₹)</span><input inputMode="decimal" value={draft.referredRewardRupees} onChange={(event) => setDraft({ ...draft, referredRewardRupees: event.target.value })} placeholder="100.00" /></label>
          <label className="a-field"><span><Users size={18} /> Minimum eligible customers added</span><input inputMode="numeric" value={draft.minimumCustomers} onChange={(event) => setDraft({ ...draft, minimumCustomers: event.target.value })} /></label>
          <div className="a-form-actions"><Button onClick={() => void save()} disabled={busy || !canManage || !verified || !dirty}>{busy ? "Saving…" : "Save settings"}</Button><Button variant="outline" onClick={() => { setDraft(draftFrom(settings)); setError(""); }} disabled={busy || !dirty}>Cancel</Button></div>
          {error ? <p role="alert" className="a-field-error">{error}</p> : null}
        </div>
      </div>
      <div className="a-card"><div className="a-card-body"><h2>Reward behavior</h2><p>When the new shop creates the configured number of active customers, the referring shop and new shop receive their separately configured wallet rewards. Rewards use INR paise and are issued once.</p><p>Changes affect referrals created after the save. Existing pending referrals keep the reward amounts and customer threshold captured when their code was accepted.</p><p>To change these financial settings, confirm your identity in <Link href="/admin/settings" className="a-link">Settings</Link>. Backend authorization remains enforced.</p><p>Current rewards: referring shop <strong>{money(settings.referrerRewardAmountMinor)}</strong>; new shop <strong>{money(settings.referredRewardAmountMinor)}</strong>. Qualification: <strong>{settings.minimumCustomers}</strong> active customer(s).</p></div></div>
    </div>
  );
}
