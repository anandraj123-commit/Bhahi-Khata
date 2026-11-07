"use client";
import { useState } from "react";
import { useAdminQuery } from "../../../hooks/admin/use-admin-query";
import { adminRequest, date, money } from "../../../lib/admin/api";
import { useAdmin } from "../layout/shell";
import { Button, ErrorState } from "../shared/ui";
import type { DataRow } from "../../../types/admin";
export function PaymentOrders({ shopId }: { shopId?: string }) {
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const session = useAdmin();
  const health = useAdminQuery<DataRow>("payment-health");
  const missing = useAdminQuery<DataRow[]>("payment-recovery-snapshots?page=1&limit=20");
  const refunds = useAdminQuery<DataRow[]>(`payment-refunds?page=1&limit=20${shopId ? `&shopId=${shopId}` : ""}`);
  const recovery = useAdminQuery<DataRow[]>("payment-recovery-events?page=1&limit=20");
  const query = useAdminQuery<DataRow[]>(`payment-orders?page=${page}&limit=20${shopId ? `&shopId=${shopId}` : ""}`);
  async function reconcile(id: string) {
    setBusy(true);
    try {
      const result = await adminRequest<{ status: string }>(`payment-orders/${id}/reconcile`, { method: "POST", csrf: session.csrfToken });
      setMessage(`Server verification: ${result.data.status}`);
      await query.refetch();
    } catch(error) { setMessage(error instanceof Error ? error.message : "Verification unavailable"); }
    finally { setBusy(false); }
  }
  return <section className="a-card">
    <div className="a-card-head"><h2>Payment attempts and reconciliation</h2></div>
    {message && <p role="status">{message}</p>}
    {!shopId && <div>
      {health.isError && <ErrorState message={health.error.message} retry={() => void health.refetch()} />}
      {health.data?.data && <p role="status">Webhook backlog: {Number(health.data.data.webhookBacklog)} · Over one hour: {Number(health.data.data.overdueWebhooks)} · Order errors: {Number(health.data.data.orderErrors)} · Refund errors: {Number(health.data.data.refundErrors)} · Missing-order reviews: {Number(health.data.data.missingOrderReviews)}</p>}
      <h3>Missing-order recovery review (latest 20)</h3>
      {missing.isError && <ErrorState message={missing.error.message} retry={() => void missing.refetch()} />}
      <ul>{(missing.data?.data || []).map(row => <li key={String(row._id)}>{String(row._id)} · {String(row.reconciliationLastCode)} · Next: {date(row.reconciliationNextAt)} {session.permissions.includes("payments:reconcile") && <Button variant="outline" disabled={busy} onClick={() => void reconcile(String(row._id))}>Verify with gateway</Button>}</li>)}</ul>
    </div>}
    {query.isError && <ErrorState message={query.error.message} retry={() => void query.refetch()} />}
    <div className="a-table-wrap"><table className="a-table"><thead><tr><th>Shop / order</th><th>Plan / amount</th><th>Status</th><th>Verification</th><th>Reconciliation</th><th>Action</th></tr></thead><tbody>
      {(query.data?.data || []).map(row => <tr key={String(row._id)}>
        <td>{String(row.shopName)}<small>{String(row.gatewayOrderId || row._id)}</small></td>
        <td>{String(row.planCode)} · {money(Number(row.amountMinor), String(row.currency))}<small>{date(row.createdAt)}</small></td>
        <td>{String(row.status)}<small>Gateway order: {String(row.gatewayOrderStatus || "Unknown")}</small><small>Latest attempt: {String(row.latestPaymentStatus || "Unknown")} · {String(row.latestPaymentId || "—")}</small></td><td>{row.verifiedAt ? date(row.verifiedAt) : "Unverified"}</td>
        <td>{String(row.paymentReconciliationLastCode || "—")}<small>Last checked: {date(row.paymentReconciliationCheckedAt)} · Attempts: {Number(row.paymentReconciliationAttempts || 0)} · Next: {date(row.paymentReconciliationNextAt)}</small></td>
        <td>{session.permissions.includes("payments:reconcile") && <Button variant="outline" disabled={busy} onClick={() => void reconcile(String(row._id))}>Verify with gateway</Button>}</td>
      </tr>)}
    </tbody></table></div>
    <div className="a-pagination"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={(query.data?.data.length || 0) < 20} onClick={() => setPage(page + 1)}>Next</Button></div>
    <div><h3>Verified refunds (latest 20)</h3>
      {refunds.isError && <ErrorState message={refunds.error.message} retry={() => void refunds.refetch()} />}
      <ul>{(refunds.data?.data || []).map(row => <li key={String(row._id)}>{String(row.gatewayRefundId)} · {String(row.gatewayPaymentId)} · {String(row.gatewayStatus)} · {money(Number(row.amountMinor), String(row.currency))} · Entitlement review required</li>)}</ul>
    </div>
    {!shopId && <div><h3>Webhook recovery events (latest 20)</h3>
      {recovery.isError && <ErrorState message={recovery.error.message} retry={() => void recovery.refetch()} />}
      <Button variant="outline" onClick={() => void recovery.refetch()}>Refresh recovery events</Button>
      <ul>{(recovery.data?.data || []).map(row => <li key={String(row._id)}>{String(row.eventType)} · {String(row.orderId)} · {String(row.status)} · {String(row.lastErrorCode || "—")} · Retries: {Number(row.attempts || 0)} · Next: {date(row.nextAttemptAt)}</li>)}</ul>
    </div>}
  </section>;
}
