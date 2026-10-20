import type { Audit, Customer, Data, Entry } from "./model";
import { withoutLegacyDue, withoutLegacyDueFromAudit } from "./ledgerCompatibility";

export type RecordChange<T> = {
  operation: "create" | "update" | "delete";
  before?: T;
  after?: T;
};
export type SyncSettings = Pick<
  Data,
  "shop" | "language" | "defaultMethod" | "reminders"
>;
export type SyncDelta = {
  settings?: { before: SyncSettings; after: SyncSettings };
  customers: RecordChange<Customer>[];
  entries: RecordChange<Entry>[];
  audit: Audit[];
  read: string[];
};

/** Normalize durable queue records written by app versions that had Due Date. */
export function normalizeSyncDelta(change: SyncDelta): SyncDelta {
  return {
    ...change,
    entries: change.entries.map((item) => ({
      ...item,
      ...(item.before ? { before: withoutLegacyDue(item.before) as Entry } : {}),
      ...(item.after ? { after: withoutLegacyDue(item.after) as Entry } : {}),
    })),
    audit: change.audit.map((item) => withoutLegacyDueFromAudit(item)),
  };
}

const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

function changes<T extends { id: string }>(before: T[], after: T[]) {
  const old = new Map(before.map((item) => [item.id, item]));
  const next = new Map(after.map((item) => [item.id, item]));
  const result: RecordChange<T>[] = [];
  for (const item of after) {
    const prior = old.get(item.id);
    if (!prior) result.push({ operation: "create", after: item });
    else if (!equal(prior, item))
      result.push({ operation: "update", before: prior, after: item });
  }
  for (const item of before)
    if (!next.has(item.id)) result.push({ operation: "delete", before: item });
  return result;
}

function settingsOf(data: Data): SyncSettings {
  return {
    shop: data.shop,
    language: data.language,
    defaultMethod: data.defaultMethod,
    reminders: data.reminders,
  };
}

export function createSyncDelta(previous: Data, next: Data): SyncDelta {
  const before = settingsOf(previous);
  const after = settingsOf(next);
  const priorAuditIds = new Set(previous.audit.map((item) => item.id));
  return normalizeSyncDelta({
    ...(equal(before, after) ? {} : { settings: { before, after } }),
    customers: changes(previous.customers, next.customers),
    entries: changes(
      previous.entries.map((entry) => withoutLegacyDue(entry) as Entry),
      next.entries.map((entry) => withoutLegacyDue(entry) as Entry),
    ),
    audit: next.audit.filter((item) => !priorAuditIds.has(item.id)),
    read: next.read.filter((id) => !previous.read.includes(id)),
  });
}
