import type { Audit, DeletedEntry, Entry } from "./model";

/** Rebuild legacy local tombstones from the durable audit log when older caches
 * predate the deletedEntries account snapshot. The active ledger decides whether
 * an item has since been restored. */
export function deletedEntriesFromHistory(audit: Audit[], activeEntries: Entry[]): DeletedEntry[] {
  const activeIds = new Set(activeEntries.map((entry) => entry.id));
  const latest = new Map<string, { kind: "deleted" | "restored"; entry: Entry; date: string }>();
  const ordered = audit.map((event, index) => ({ event, index }))
    .sort((a, b) => Date.parse(b.event.date) - Date.parse(a.event.date) || a.index - b.index)
    .map(({ event }) => event);
  for (const event of ordered) {
    if (event.action !== "Deleted transaction" && event.action !== "Restored transaction") continue;
    const entry = event.after || event.before;
    if (!entry || latest.has(entry.id)) continue;
    const timestamp = Date.parse(event.date);
    if (!Number.isFinite(timestamp)) continue;
    latest.set(entry.id, {
      kind: event.action === "Deleted transaction" ? "deleted" : "restored",
      entry,
      date: new Date(timestamp).toISOString(),
    });
  }
  return [...latest.values()]
    .filter((record) => record.kind === "deleted" && !activeIds.has(record.entry.id))
    .map((record) => ({ ...record.entry, deletedAt: record.date }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.id.localeCompare(b.id));
}
