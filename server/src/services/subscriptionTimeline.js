/** UTC half-open intervals. Future work is ordered by tier, paused time, then FIFO.
 * Moving an existing interval preserves its exact milliseconds. A new purchase
 * receives calendar months at its first scheduled start (clamped month ends).
 */
// Canonical tier order is invariant across admin configuration revisions.
// Comparing historical numeric snapshots would allow a newly renumbered Pro
// purchase to interrupt an older Business entitlement.
export const tierOf = (row) => ({ free: 0, pro: 1, business: 2 }[row.planCode] ?? row.planSnapshot?.tier ?? 0);
export function calendarMonths(date, months) {
  const result = new Date(date), day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  result.setUTCDate(Math.min(day, new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()));
  return result;
}
export function effectiveStatus(row, now) {
  if (!["active", "paused", "scheduled"].includes(row.status)) return row.status;
  if (row.expiresAt && +new Date(row.expiresAt) <= +now) return "expired";
  if (+new Date(row.startsAt) <= +now) return "active";
  return row.status === "paused" ? "paused" : "scheduled";
}
export function schedulePurchase(records, purchase, now) {
  const time = +now;
  const rows = records.filter(r => ["active", "paused", "scheduled"].includes(r.status) && +new Date(r.expiresAt) > time)
    .map(r => ({ ...r, startsAt: new Date(r.startsAt), expiresAt: new Date(r.expiresAt), segments: [...(r.segments || [])] }));
  const active = rows.filter(r => +r.startsAt <= time);
  if (active.length > 1) throw new Error("Overlapping legacy subscription intervals require review");
  const current = active[0];
  const incoming = { ...purchase, _id: "preview", startsAt: new Date(now), status: "scheduled", segments: [] };
  let head = current;
  if (!current || tierOf(incoming) > tierOf(current)) {
    head = incoming;
    if (current) {
      current.remainingMilliseconds = +current.expiresAt - time;
      current.segments.push({ startsAt: current.startsAt, expiresAt: new Date(now) });
      current.status = "paused";
      current.pauseReason = "higher_tier_purchase";
    }
  }
  const queue = [...rows.filter(r => r !== head), ...(head === incoming ? [] : [incoming])];
  queue.sort((a, b) => tierOf(b) - tierOf(a) ||
    Number(b.status === "paused") - Number(a.status === "paused") ||
    (+new Date(a.createdAt || now) - +new Date(b.createdAt || now)) || String(a._id).localeCompare(String(b._id)));
  const ordered = [head, ...queue];
  let cursor = time;
  for (const row of ordered) {
    if (row === current && row === head) {
      row.status = "active";
      cursor = +row.expiresAt;
      continue;
    }
    const duration = row === incoming ? null : row.status === "paused" && row.remainingMilliseconds != null
      ? row.remainingMilliseconds : +row.expiresAt - +row.startsAt;
    row.startsAt = new Date(cursor);
    row.expiresAt = duration === null ? calendarMonths(row.startsAt, purchase.durationMonths) : new Date(cursor + duration);
    row.status = cursor === time ? "active" : row.status === "paused" ? "paused" : "scheduled";
    cursor = +row.expiresAt;
  }
  return { incoming, rows, ordered };
}
