import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type * as SQLiteTypes from "expo-sqlite";
import type { Audit, Customer, Data, Entry } from "./model";
import { createSyncDelta, type SyncDelta, type SyncSettings } from "./syncDelta";

const DATABASE = "digital-khata-offline.db";
const KEY_NAME = "khata.sqlite.key.v1";
const OFFLINE_SESSION = "khata.offline-session.v1";
const OFFLINE_SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
let database: Promise<SQLiteTypes.SQLiteDatabase | null> | null = null;
let nativeDatabaseUnavailable = false;

export type OfflineSession = {
  accountId: string;
  authenticatedAt: number;
  refreshTokenHash: string;
};
export type PendingChange = {
  id: number;
  change: SyncDelta;
};
export type SyncQueueStatus = {
  pending: number;
  failed: number;
  conflicts: number;
};
export type PendingConflict = {
  kind?: "entry";
  queueId: number;
  entryId: string;
  local: NonNullable<SyncDelta["entries"][number]["after"]>;
  server: NonNullable<SyncDelta["entries"][number]["after"]> | null;
  expectedVersion: number;
  expectedResolutionVersion: number;
  resolutionId: string;
  localDeleted: boolean;
  localAt: string;
  chosen?: "keep_local" | "keep_server";
};
export type PendingCustomerConflict = {
  kind: "customer";
  queueId: number;
  customerId: string;
  local: import("./model").Customer;
  server: import("./model").Customer | null;
  expectedVersion: number;
  expectedResolutionVersion: number;
  resolutionId: string;
  localDeleted: boolean;
  localAt: string;
  chosen?: "keep_local" | "keep_server";
};
export type PendingSettingsConflict = {
  kind: "settings";
  queueId: number;
  local: SyncSettings;
  server: SyncSettings;
  expectedVersion: number;
  expectedResolutionVersion: number;
  resolutionId: string;
  localAt: string;
  chosen?: "keep_local" | "keep_server";
};

export const offlineStorageAvailable = () =>
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient &&
  !nativeDatabaseUnavailable;

async function openDatabase() {
  if (!offlineStorageAvailable()) return null;
  if (!database) {
    database = (async () => {
      let SQLite: typeof import("expo-sqlite");
      try {
        SQLite = await import("expo-sqlite");
      } catch {
        nativeDatabaseUnavailable = true;
        return null;
      }
      let key = await SecureStore.getItemAsync(KEY_NAME);
      if (!key) {
        const bytes = await Crypto.getRandomBytesAsync(32);
        key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        await SecureStore.setItemAsync(KEY_NAME, key);
      }
      const db = await SQLite.openDatabaseAsync(DATABASE);
      await db.execAsync(`PRAGMA key = "x'${key}'";`);
      const cipher = await db.getFirstAsync<{ cipher_version: string }>(
        "PRAGMA cipher_version",
      );
      if (!cipher?.cipher_version)
        throw new Error("Encrypted local storage requires the installed app build");
      await db.execAsync("PRAGMA journal_mode = WAL;");
      const currentVersion =
        (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version || 0;
      if (currentVersion > 5)
        throw new Error("Offline database version is newer than this app");
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS local_accounts (
          account_id TEXT PRIMARY KEY NOT NULL,
          shop_json TEXT NOT NULL,
          preferences_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_customers (
          account_id TEXT NOT NULL,
          customer_id TEXT NOT NULL,
          record_json TEXT NOT NULL,
          PRIMARY KEY (account_id, customer_id)
        );
        CREATE TABLE IF NOT EXISTS local_ledger (
          account_id TEXT NOT NULL,
          entry_id TEXT NOT NULL,
          customer_id TEXT NOT NULL,
          record_json TEXT NOT NULL,
          PRIMARY KEY (account_id, entry_id)
        );
        CREATE INDEX IF NOT EXISTS local_ledger_customer_idx
          ON local_ledger (account_id, customer_id);
        CREATE TABLE IF NOT EXISTS local_audit (
          account_id TEXT NOT NULL,
          audit_id TEXT NOT NULL,
          record_json TEXT NOT NULL,
          PRIMARY KEY (account_id, audit_id)
        );
        CREATE TABLE IF NOT EXISTS local_subscription_cache (
          account_id TEXT PRIMARY KEY NOT NULL,
          snapshot_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL,
          previous_json TEXT,
          next_json TEXT,
          change_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          state TEXT NOT NULL DEFAULT 'pending',
          conflict_json TEXT,
          operation_id TEXT,
          entity_type TEXT,
          entity_id TEXT,
          base_version INTEGER,
          next_attempt_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS sync_queue_account_order_idx
          ON sync_queue (account_id, id);
      `);
      {
        const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(sync_queue)");
        if (!columns.some((column) => column.name === "change_json")) {
          await db.execAsync("ALTER TABLE sync_queue ADD COLUMN change_json TEXT");
          columns.push({ name: "change_json" });
        }
        if (!columns.some((column) => column.name === "state")) {
          await db.execAsync("ALTER TABLE sync_queue ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'");
        }
        if (!columns.some((column) => column.name === "conflict_json")) {
          await db.execAsync("ALTER TABLE sync_queue ADD COLUMN conflict_json TEXT");
        }
        for (const [name, definition] of [
          ["operation_id", "TEXT"],
          ["entity_type", "TEXT"],
          ["entity_id", "TEXT"],
          ["base_version", "INTEGER"],
          ["next_attempt_at", "INTEGER NOT NULL DEFAULT 0"],
        ] as const) {
          if (!columns.some((column) => column.name === name))
            await db.execAsync(`ALTER TABLE sync_queue ADD COLUMN ${name} ${definition}`);
        }
        if (columns.some((column) => column.name === "previous_json") &&
            columns.some((column) => column.name === "next_json")) {
        const legacy = await db.getAllAsync<{
          id: number;
          previous_json: string;
          next_json: string;
        }>("SELECT id, previous_json, next_json FROM sync_queue WHERE change_json IS NULL");
        for (const row of legacy) {
          const change = createSyncDelta(JSON.parse(row.previous_json), JSON.parse(row.next_json));
          await db.runAsync("UPDATE sync_queue SET change_json = ? WHERE id = ?", JSON.stringify(change), row.id);
        }
        }
      }
      if (currentVersion < 5) {
        const legacyQueue = await db.getAllAsync<{ id: number; operation_id: string | null }>(
          "SELECT id, operation_id FROM sync_queue WHERE operation_id IS NULL",
        );
        for (const row of legacyQueue)
          await db.runAsync("UPDATE sync_queue SET operation_id = ? WHERE id = ?", Crypto.randomUUID(), row.id);
        await db.execAsync("CREATE UNIQUE INDEX IF NOT EXISTS sync_queue_operation_id_idx ON sync_queue (operation_id)");
        await db.execAsync("PRAGMA user_version = 5;");
      }
      return db;
    })().catch((error) => {
      database = null;
      throw error;
    });
  }
  return database;
}

function preferencesOf(data: Data) {
  return {
    signedIn: data.signedIn,
    shopExists: data.shopExists ?? true,
    shopComplete: data.shopComplete ?? Boolean(data.shop.name.trim() && data.shop.owner.trim()),
    language: data.language,
    reminders: data.reminders,
    defaultMethod: data.defaultMethod,
    read: data.read,
  };
}

async function writeData(db: SQLiteTypes.SQLiteDatabase, accountId: string, data: Data) {
  await db.runAsync(
    `INSERT INTO local_accounts (account_id, shop_json, preferences_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET shop_json=excluded.shop_json,
       preferences_json=excluded.preferences_json, updated_at=excluded.updated_at`,
    accountId,
    JSON.stringify(data.shop),
    JSON.stringify(preferencesOf(data)),
    Date.now(),
  );
  await db.runAsync("DELETE FROM local_customers WHERE account_id = ?", accountId);
  await db.runAsync("DELETE FROM local_ledger WHERE account_id = ?", accountId);
  await db.runAsync("DELETE FROM local_audit WHERE account_id = ?", accountId);
  for (const customer of data.customers)
    await db.runAsync(
      "INSERT INTO local_customers (account_id, customer_id, record_json) VALUES (?, ?, ?)",
      accountId,
      customer.id,
      JSON.stringify(customer),
    );
  for (const entry of [...data.entries].reverse())
    await db.runAsync(
      "INSERT INTO local_ledger (account_id, entry_id, customer_id, record_json) VALUES (?, ?, ?, ?)",
      accountId,
      entry.id,
      entry.customerId,
      JSON.stringify(entry),
    );
  for (const audit of [...data.audit].reverse())
    await db.runAsync(
      "INSERT INTO local_audit (account_id, audit_id, record_json) VALUES (?, ?, ?)",
      accountId,
      audit.id,
      JSON.stringify(audit),
    );
}

async function writeChange(
  db: SQLiteTypes.SQLiteDatabase,
  accountId: string,
  next: Data,
  change: SyncDelta,
) {
  await db.runAsync(
    `INSERT INTO local_accounts (account_id, shop_json, preferences_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET shop_json=excluded.shop_json,
       preferences_json=excluded.preferences_json, updated_at=excluded.updated_at`,
    accountId,
    JSON.stringify(next.shop),
    JSON.stringify(preferencesOf(next)),
    Date.now(),
  );
  for (const item of change.customers) {
    const record = item.after;
    if (!record)
      await db.runAsync(
        "DELETE FROM local_customers WHERE account_id = ? AND customer_id = ?",
        accountId,
        item.before!.id,
      );
    else
      await db.runAsync(
        `INSERT INTO local_customers (account_id, customer_id, record_json) VALUES (?, ?, ?)
         ON CONFLICT(account_id, customer_id) DO UPDATE SET record_json=excluded.record_json`,
        accountId,
        record.id,
        JSON.stringify(record),
      );
  }
  for (const item of change.entries) {
    const record = item.after;
    if (!record)
      await db.runAsync(
        "DELETE FROM local_ledger WHERE account_id = ? AND entry_id = ?",
        accountId,
        item.before!.id,
      );
    else
      await db.runAsync(
        `INSERT INTO local_ledger (account_id, entry_id, customer_id, record_json) VALUES (?, ?, ?, ?)
         ON CONFLICT(account_id, entry_id) DO UPDATE SET customer_id=excluded.customer_id,
           record_json=excluded.record_json`,
        accountId,
        record.id,
        record.customerId,
        JSON.stringify(record),
      );
  }
  for (const audit of change.audit)
    await db.runAsync(
      "INSERT OR IGNORE INTO local_audit (account_id, audit_id, record_json) VALUES (?, ?, ?)",
      accountId,
      audit.id,
      JSON.stringify(audit),
    );
}

export async function cacheAuthenticatedAccount(accountId: string, data: Data) {
  if (!offlineStorageAvailable()) return;
  const db = await openDatabase();
  if (!db) return;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const pending = await transaction.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sync_queue WHERE account_id = ?",
      accountId,
    );
    if ((pending?.count || 0) === 0) await writeData(transaction, accountId, data);
  });
  await markOfflineSessionAuthenticated(accountId);
}

async function markOfflineSessionAuthenticated(accountId: string) {
  const refreshToken = await SecureStore.getItemAsync("khata.refresh.v1");
  if (!refreshToken) return;
  const refreshTokenHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    refreshToken,
  );
  await SecureStore.setItemAsync(
    OFFLINE_SESSION,
    JSON.stringify({
      accountId,
      authenticatedAt: Date.now(),
      refreshTokenHash,
    } satisfies OfflineSession),
  );
}

export async function adoptServerDataIfQueueEmpty(accountId: string, data: Data) {
  const db = await openDatabase();
  if (!db) return false;
  let adopted = false;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const pending = await transaction.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sync_queue WHERE account_id = ?",
      accountId,
    );
    if ((pending?.count || 0) > 0) return;
    await writeData(transaction, accountId, data);
    adopted = true;
  });
  if (adopted) await markOfflineSessionAuthenticated(accountId);
  return adopted;
}

export async function saveLocalChange(
  accountId: string,
  previous: Data,
  next: Data,
) {
  const db = await openDatabase();
  if (!db) return null;
  let queueId: number | null = null;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const change = createSyncDelta(previous, next);
    await writeChange(transaction, accountId, next, change);
    const customerChange = change.customers[0];
    const entryChange = change.entries[0];
    const operation = customerChange || entryChange;
    const record = operation?.after || operation?.before;
    const entityType = change.settings ? "settings" : customerChange ? "customer" : entryChange ? "entry" : "account";
    const baseVersion = change.settings
      ? change.settings.before.shop.serverVersion || null
      : (operation?.before as { serverVersion?: number } | undefined)?.serverVersion || null;
    const inserted = await transaction.runAsync(
      `INSERT INTO sync_queue
        (account_id, previous_json, next_json, change_json, created_at, operation_id,
         entity_type, entity_id, base_version, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      accountId,
      "{}",
      "{}",
      JSON.stringify(change),
      Date.now(),
      Crypto.randomUUID(),
      entityType,
      record?.id || (change.settings ? accountId : null),
      baseVersion,
    );
    queueId = inserted.lastInsertRowId;
  });
  return queueId;
}

export async function readCachedAccount(accountId: string): Promise<Data | null> {
  const db = await openDatabase();
  if (!db) return null;
  const account = await db.getFirstAsync<{
    shop_json: string;
    preferences_json: string;
  }>("SELECT shop_json, preferences_json FROM local_accounts WHERE account_id = ?", accountId);
  if (!account) return null;
  const [customers, entries, audit] = await Promise.all([
    db.getAllAsync<{ record_json: string }>(
      "SELECT record_json FROM local_customers WHERE account_id = ? ORDER BY rowid",
      accountId,
    ),
    db.getAllAsync<{ record_json: string }>(
      "SELECT record_json FROM local_ledger WHERE account_id = ? ORDER BY rowid DESC",
      accountId,
    ),
    db.getAllAsync<{ record_json: string }>(
      "SELECT record_json FROM local_audit WHERE account_id = ? ORDER BY rowid DESC",
      accountId,
    ),
  ]);
  const preferences = JSON.parse(account.preferences_json);
  return {
    shop: JSON.parse(account.shop_json),
    customers: customers.map((row) => JSON.parse(row.record_json)),
    entries: entries.map((row) => JSON.parse(row.record_json)),
    audit: audit.map((row) => JSON.parse(row.record_json)),
    ...preferences,
  } as Data;
}

export async function cacheSubscriptionSnapshot(accountId: string, snapshot: unknown) {
  const db = await openDatabase();
  if (!db) return false;
  await db.runAsync(
    `INSERT INTO local_subscription_cache (account_id, snapshot_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,
       updated_at=excluded.updated_at`,
    accountId,
    JSON.stringify(snapshot),
    Date.now(),
  );
  return true;
}

export async function readSubscriptionSnapshot(accountId: string): Promise<unknown | null> {
  const db = await openDatabase();
  if (!db) return null;
  const row = await db.getFirstAsync<{ snapshot_json: string }>(
    "SELECT snapshot_json FROM local_subscription_cache WHERE account_id = ?",
    accountId,
  );
  if (!row) return null;
  try { return JSON.parse(row.snapshot_json); } catch { return null; }
}

export async function readOfflineSession(): Promise<OfflineSession | null> {
  const [raw, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(OFFLINE_SESSION),
    SecureStore.getItemAsync("khata.refresh.v1"),
  ]);
  if (!raw || !refreshToken) return null;
  try {
    const session = JSON.parse(raw) as OfflineSession;
    const age = Date.now() - session.authenticatedAt;
    if (
      !/^\d{8,15}$/.test(session.accountId) ||
      !Number.isSafeInteger(session.authenticatedAt) ||
      typeof session.refreshTokenHash !== "string" ||
      age < 0 ||
      age > OFFLINE_SESSION_MAX_AGE
    )
      return null;
    const refreshTokenHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      refreshToken,
    );
    if (refreshTokenHash !== session.refreshTokenHash) return null;
    return session;
  } catch {
    return null;
  }
}

export async function readNextChange(accountId: string): Promise<PendingChange | null> {
  const db = await openDatabase();
  if (!db) return null;
  const blockedRows = await db.getAllAsync<{
    state: string;
    conflict_json: string | null;
    change_json: string;
  }>(
    "SELECT state, conflict_json, change_json FROM sync_queue WHERE account_id = ? AND state IN ('conflict', 'failed')",
    accountId,
  );
  const blockedEntries = new Set<string>();
  const blockedCustomerMutations = new Set<string>();
  const blockedCustomerLedger = new Set<string>();
  let blockedSettings = false;
  for (const row of blockedRows) {
    if (row.state === "conflict" && row.conflict_json) {
      try {
        const conflict = JSON.parse(row.conflict_json) as unknown as { kind?: string; entryId?: string; customerId?: string; localDeleted?: boolean };
        if (conflict.kind === "settings") {
          blockedSettings = true;
        } else if (conflict.kind === "customer") {
          const customerConflict = conflict as unknown as PendingCustomerConflict;
          blockedCustomerMutations.add(customerConflict.customerId);
          if (customerConflict.localDeleted) blockedCustomerLedger.add(customerConflict.customerId);
        } else if (conflict.entryId) blockedEntries.add(conflict.entryId);
      } catch {
        // Keep the damaged conflict durable and do not infer a resolution.
      }
      continue;
    }
    try {
      const failed = JSON.parse(row.change_json) as SyncDelta;
      blockedSettings ||= !!failed.settings;
      for (const item of failed.customers) {
        const customer = item.after || item.before;
        if (customer) {
          blockedCustomerMutations.add(customer.id);
          if (item.operation === "create" || item.operation === "delete")
            blockedCustomerLedger.add(customer.id);
        }
      }
      for (const item of failed.entries) {
        const entry = item.after || item.before;
        if (entry) {
          blockedEntries.add(entry.id);
        }
      }
    } catch {
      // Keep corrupt queue records; valid unrelated operations can still sync.
    }
  }
  const pending = await db.getAllAsync<{ id: number; change_json: string; next_attempt_at: number }>(
    "SELECT id, change_json, next_attempt_at FROM sync_queue WHERE account_id = ? AND state = 'pending' ORDER BY id",
    accountId,
  );
  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index];
    const change = JSON.parse(item.change_json) as SyncDelta;
    if (item.next_attempt_at > Date.now()) {
      blockedSettings ||= !!change.settings;
      for (const customerChange of change.customers) {
        const customer = customerChange.after || customerChange.before;
        if (customer) {
          blockedCustomerMutations.add(customer.id);
          if (customerChange.operation === "create") blockedCustomerLedger.add(customer.id);
        }
      }
      for (const entryChange of change.entries) {
        const entry = entryChange.after || entryChange.before;
        if (entry) blockedEntries.add(entry.id);
      }
      continue;
    }
    const touchesBlockedSetting = !!change.settings && blockedSettings;
    const touchesBlockedCustomer = change.customers.some((item) =>
      blockedCustomerMutations.has((item.after || item.before)!.id),
    );
    const touchesBlockedEntry = change.entries.some((item) => {
      const entry = item.after || item.before!;
      return blockedEntries.has(entry.id) || blockedCustomerLedger.has(entry.customerId);
    });
    if (touchesBlockedSetting || touchesBlockedCustomer || touchesBlockedEntry)
      continue;
    const customerDeletion = change.customers.find((customer) => customer.operation === "delete");
    const deletedCustomer = customerDeletion?.before?.id;
    if (deletedCustomer) {
      const laterRows = await db.getAllAsync<{ id: number; change_json: string }>(
        "SELECT id, change_json FROM sync_queue WHERE account_id = ? AND state IN ('pending', 'failed', 'conflict') ORDER BY id",
        accountId,
      );
      const hasLedgerDependency = laterRows.some((later) => {
        if (later.id === item.id) return false;
        try {
          const laterChange = JSON.parse(later.change_json) as SyncDelta;
          return laterChange.entries.some((entry) => (entry.after || entry.before)?.customerId === deletedCustomer);
        } catch { return true; }
      });
      if (hasLedgerDependency) continue;
    }
    return { id: item.id, change };
  }
  return null;
}

export async function markConflict(
  id: number,
  change: SyncDelta,
  server: PendingConflict["server"],
  serverVersion?: number,
  serverResolutionVersion?: number,
) {
  const db = await openDatabase();
  if (!db) return;
  const operation = change.entries.find((item) => item.operation === "update" || item.operation === "delete");
  if (!operation) return;
  const local = operation.after || operation.before!;
  const localAudit = change.audit.find((item) => item.after?.id === local.id || item.before?.id === local.id);
  const conflict: PendingConflict = {
    kind: "entry",
    queueId: id,
    entryId: local.id,
    local,
    server,
    expectedVersion: server?.serverVersion || serverVersion || local.serverVersion || 1,
    expectedResolutionVersion: server?.resolutionVersion || serverResolutionVersion || local.resolutionVersion || 1,
    resolutionId: Crypto.randomUUID(),
    localDeleted: operation.operation === "delete",
    localAt: localAudit?.date && Number.isFinite(Date.parse(localAudit.date))
      ? new Date(localAudit.date).toISOString()
      : new Date().toISOString(),
  };
  await db.runAsync(
    "UPDATE sync_queue SET state = 'conflict', conflict_json = ?, attempts = attempts + 1, last_error = ? WHERE id = ?",
    JSON.stringify(conflict), "Financial transaction changed on the server", id,
  );
}

export async function markCustomerConflict(
  id: number,
  change: SyncDelta,
  server: import("./model").Customer | null,
  serverVersion?: number,
  serverResolutionVersion?: number,
) {
  const db = await openDatabase();
  if (!db) return;
  const operation = change.customers.find((item) => item.operation === "create" || item.operation === "update" || item.operation === "delete");
  if (!operation) return;
  const local = operation.after || operation.before!;
  const audit = change.audit.find((item) => item.action.toLowerCase().includes("customer"));
  const conflict: PendingCustomerConflict = {
    kind: "customer",
    queueId: id,
    customerId: local.id,
    local,
    server,
    expectedVersion: server?.serverVersion || serverVersion || local.serverVersion || 1,
    expectedResolutionVersion: server?.resolutionVersion || serverResolutionVersion || local.resolutionVersion || 1,
    resolutionId: Crypto.randomUUID(),
    localDeleted: operation.operation === "delete",
    localAt: audit?.date && Number.isFinite(Date.parse(audit.date))
      ? new Date(audit.date).toISOString()
      : new Date().toISOString(),
  };
  await db.runAsync(
    "UPDATE sync_queue SET state = 'conflict', conflict_json = ?, attempts = attempts + 1, last_error = ? WHERE id = ? AND state = 'pending'",
    JSON.stringify(conflict), "Customer changed on the server", id,
  );
}

export async function readPendingConflicts(accountId: string): Promise<PendingConflict[]> {
  const db = await openDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<{ conflict_json: string }>(
    "SELECT conflict_json FROM sync_queue WHERE account_id = ? AND state = 'conflict' AND conflict_json IS NOT NULL ORDER BY id",
    accountId,
  );
  return rows.flatMap((row) => { try { const value = JSON.parse(row.conflict_json) as unknown as { kind?: string }; return value.kind === "customer" || value.kind === "settings" ? [] : [value as PendingConflict]; } catch { return []; } });
}

export async function readPendingCustomerConflicts(accountId: string): Promise<PendingCustomerConflict[]> {
  const db = await openDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<{ conflict_json: string }>(
    "SELECT conflict_json FROM sync_queue WHERE account_id = ? AND state = 'conflict' AND conflict_json IS NOT NULL ORDER BY id",
    accountId,
  );
  return rows.flatMap((row) => {
    try {
      const value = JSON.parse(row.conflict_json) as PendingCustomerConflict;
      return value.kind === "customer" ? [value] : [];
    } catch { return []; }
  });
}

function settingsFromServer(server: Record<string, unknown>): SyncSettings {
  const shop = server;
  return {
    shop: {
      name: String(shop.name || ""),
      owner: String(shop.owner || ""),
      address: String(shop.address || ""),
      phone: String(shop.phone || "").replace(/^\+91/, ""),
      whatsapp: String(shop.whatsapp || ""),
      serverVersion: Number(shop.serverVersion) || 1,
      resolutionVersion: Number(shop.resolutionVersion) || 1,
    },
    language: String(shop.language || "English"),
    defaultMethod: String(shop.defaultMethod || "Cash"),
    reminders: shop.reminders as SyncSettings["reminders"],
  };
}

export async function markSettingsConflict(id: number, change: SyncDelta, server: Record<string, unknown>) {
  const db = await openDatabase();
  if (!db || !change.settings) return;
  const conflict: PendingSettingsConflict = {
    kind: "settings",
    queueId: id,
    local: change.settings.after,
    server: settingsFromServer(server),
    expectedVersion: Number(server.serverVersion) || 1,
    expectedResolutionVersion: Number(server.resolutionVersion) || 1,
    resolutionId: Crypto.randomUUID(),
    localAt: new Date().toISOString(),
  };
  await db.runAsync(
    "UPDATE sync_queue SET state = 'conflict', conflict_json = ?, attempts = attempts + 1, last_error = ? WHERE id = ? AND state = 'pending'",
    JSON.stringify(conflict), "Shop settings changed on another device", id,
  );
}

export async function readPendingSettingsConflicts(accountId: string): Promise<PendingSettingsConflict[]> {
  const db = await openDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<{ conflict_json: string }>(
    "SELECT conflict_json FROM sync_queue WHERE account_id = ? AND state = 'conflict' AND conflict_json IS NOT NULL ORDER BY id",
    accountId,
  );
  return rows.flatMap((row) => {
    try {
      const value = JSON.parse(row.conflict_json) as PendingSettingsConflict;
      return value.kind === "settings" ? [value] : [];
    } catch { return []; }
  });
}

export async function refreshSettingsConflict(id: number, server: Record<string, unknown>) {
  const db = await openDatabase();
  if (!db) return;
  const row = await db.getFirstAsync<{ conflict_json: string }>("SELECT conflict_json FROM sync_queue WHERE id = ? AND state = 'conflict'", id);
  if (!row) return;
  const conflict = JSON.parse(row.conflict_json) as PendingSettingsConflict;
  conflict.server = settingsFromServer(server);
  conflict.expectedVersion = Number(server.serverVersion) || 1;
  conflict.expectedResolutionVersion = Number(server.resolutionVersion) || 1;
  conflict.chosen = undefined;
  conflict.resolutionId = Crypto.randomUUID();
  await db.runAsync("UPDATE sync_queue SET conflict_json = ? WHERE id = ?", JSON.stringify(conflict), id);
}

export async function chooseSettingsConflictResolution(id: number, choice: "keep_local" | "keep_server") {
  const db = await openDatabase();
  if (!db) throw new Error("Encrypted offline storage is unavailable");
  const row = await db.getFirstAsync<{ conflict_json: string }>("SELECT conflict_json FROM sync_queue WHERE id = ? AND state = 'conflict'", id);
  if (!row) throw new Error("The pending settings conflict is unavailable");
  const conflict = JSON.parse(row.conflict_json) as PendingSettingsConflict;
  conflict.chosen = choice;
  await db.runAsync("UPDATE sync_queue SET conflict_json = ? WHERE id = ?", JSON.stringify(conflict), id);
  return conflict;
}

export async function completeSettingsConflict(accountId: string, conflict: PendingSettingsConflict, authoritative: SyncSettings, audit: Audit) {
  const db = await openDatabase();
  if (!db) throw new Error("Encrypted offline storage is unavailable");
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const conflicted = await transaction.getFirstAsync<{ change_json: string }>(
      "SELECT change_json FROM sync_queue WHERE account_id = ? AND id = ? AND state = 'conflict'",
      accountId, conflict.queueId,
    );
    if (!conflicted) return;
    const later = await transaction.getAllAsync<{ id: number; change_json: string }>(
      "SELECT id, change_json FROM sync_queue WHERE account_id = ? AND id > ? AND state = 'pending' ORDER BY id",
      accountId, conflict.queueId,
    );
    let rebase = authoritative;
    let dependent = false;
    for (const row of later) {
      const change = JSON.parse(row.change_json) as SyncDelta;
      if (!change.settings) continue;
      dependent = true;
      change.settings.before = rebase;
      change.settings.after.shop.serverVersion = rebase.shop.serverVersion;
      change.settings.after.shop.resolutionVersion = rebase.shop.resolutionVersion;
      await transaction.runAsync(
        "UPDATE sync_queue SET change_json = ?, base_version = ? WHERE id = ?",
        JSON.stringify(change), rebase.shop.serverVersion || 1, row.id,
      );
      rebase = change.settings.after;
    }
    const account = await transaction.getFirstAsync<{ shop_json: string; preferences_json: string }>(
      "SELECT shop_json, preferences_json FROM local_accounts WHERE account_id = ?",
      accountId,
    );
    if (account) {
      const oldShop = JSON.parse(account.shop_json);
      const oldPreferences = JSON.parse(account.preferences_json);
      const shop = dependent ? { ...oldShop, serverVersion: authoritative.shop.serverVersion, resolutionVersion: authoritative.shop.resolutionVersion } : authoritative.shop;
      const preferences = dependent ? oldPreferences : {
        ...oldPreferences,
        language: authoritative.language,
        defaultMethod: authoritative.defaultMethod,
        reminders: authoritative.reminders,
      };
      await transaction.runAsync(
        "UPDATE local_accounts SET shop_json = ?, preferences_json = ?, updated_at = ? WHERE account_id = ?",
        JSON.stringify(shop), JSON.stringify(preferences), Date.now(), accountId,
      );
    }
    await transaction.runAsync("INSERT OR IGNORE INTO local_audit (account_id, audit_id, record_json) VALUES (?, ?, ?)", accountId, audit.id, JSON.stringify(audit));
    const remaining = JSON.parse(conflicted.change_json) as SyncDelta;
    delete remaining.settings;
    const hasRemaining = remaining.customers.length > 0 || remaining.entries.length > 0 || remaining.audit.length > 0 || remaining.read.length > 0;
    if (hasRemaining)
      await transaction.runAsync(
        "UPDATE sync_queue SET change_json = ?, state = 'pending', conflict_json = NULL, last_error = NULL WHERE account_id = ? AND id = ?",
        JSON.stringify(remaining), accountId, conflict.queueId,
      );
    else await transaction.runAsync("DELETE FROM sync_queue WHERE account_id = ? AND id = ?", accountId, conflict.queueId);
  });
}

export async function refreshCustomerConflict(id: number, server: import("./model").Customer | null, serverVersion?: number, serverResolutionVersion?: number) {
  const db = await openDatabase();
  if (!db) return;
  const row = await db.getFirstAsync<{ conflict_json: string }>("SELECT conflict_json FROM sync_queue WHERE id = ? AND state = 'conflict'", id);
  if (!row) return;
  const conflict = JSON.parse(row.conflict_json) as PendingCustomerConflict;
  conflict.server = server;
  conflict.chosen = undefined;
  conflict.expectedVersion = server?.serverVersion || serverVersion || conflict.expectedVersion;
  conflict.expectedResolutionVersion = server?.resolutionVersion || serverResolutionVersion || conflict.expectedResolutionVersion;
  await db.runAsync("UPDATE sync_queue SET conflict_json = ? WHERE id = ?", JSON.stringify(conflict), id);
}

export async function chooseCustomerConflictResolution(id: number, choice: "keep_local" | "keep_server") {
  const db = await openDatabase();
  if (!db) throw new Error("Encrypted offline storage is unavailable");
  const row = await db.getFirstAsync<{ conflict_json: string }>("SELECT conflict_json FROM sync_queue WHERE id = ? AND state = 'conflict'", id);
  if (!row) throw new Error("The pending customer conflict is unavailable");
  const conflict = JSON.parse(row.conflict_json) as PendingCustomerConflict;
  conflict.chosen = choice;
  await db.runAsync("UPDATE sync_queue SET conflict_json = ? WHERE id = ?", JSON.stringify(conflict), id);
  return conflict;
}

export async function completeCustomerConflict(
  accountId: string,
  conflict: PendingCustomerConflict,
  authoritative: import("./model").Customer | null,
  serverVersion: number,
  serverResolutionVersion: number,
  audit: Audit,
) {
  const db = await openDatabase();
  if (!db) throw new Error("Encrypted offline storage is unavailable");
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const conflicted = await transaction.getFirstAsync<{ change_json: string }>(
      "SELECT change_json FROM sync_queue WHERE account_id = ? AND id = ? AND state = 'conflict'",
      accountId, conflict.queueId,
    );
    if (!conflicted) return;
    const later = await transaction.getAllAsync<{ id: number; change_json: string }>(
      "SELECT id, change_json FROM sync_queue WHERE account_id = ? AND id > ? AND state = 'pending' ORDER BY id",
      accountId, conflict.queueId,
    );
    let hasDependent = false;
    let rebase = authoritative;
    for (const row of later) {
      const change = JSON.parse(row.change_json) as SyncDelta;
      const item = change.customers.find((candidate) => (candidate.after || candidate.before)?.id === conflict.customerId);
      if (!item) continue;
      hasDependent = true;
      if (rebase) {
        item.before = rebase;
        if (item.after) item.after.serverVersion = rebase.serverVersion || 1;
        if (item.after) item.after.resolutionVersion = rebase.resolutionVersion || 1;
        await transaction.runAsync(
          "UPDATE sync_queue SET change_json = ?, base_version = ? WHERE id = ?",
          JSON.stringify(change), rebase.serverVersion || 1, row.id,
        );
        rebase = item.operation === "delete" ? null : item.after || rebase;
      } else if (item.operation === "delete") {
        change.customers = change.customers.filter((candidate) => candidate !== item);
        await transaction.runAsync("UPDATE sync_queue SET change_json = ? WHERE id = ?", JSON.stringify(change), row.id);
      } else {
        const pendingConflict: PendingCustomerConflict = {
          kind: "customer", queueId: row.id, customerId: conflict.customerId,
          local: item.after!, server: null, expectedVersion: serverVersion,
          expectedResolutionVersion: serverResolutionVersion,
          resolutionId: Crypto.randomUUID(), localDeleted: false, localAt: new Date().toISOString(),
        };
        await transaction.runAsync(
          "UPDATE sync_queue SET state = 'conflict', conflict_json = ?, last_error = ? WHERE id = ?",
          JSON.stringify(pendingConflict), "Customer was deleted on the server", row.id,
        );
      }
    }
    if (authoritative) {
      const cached = await transaction.getFirstAsync<{ record_json: string }>(
        "SELECT record_json FROM local_customers WHERE account_id = ? AND customer_id = ?",
        accountId, conflict.customerId,
      );
      const localRecord = cached && hasDependent
        ? { ...JSON.parse(cached.record_json), serverVersion: authoritative.serverVersion || 1, resolutionVersion: authoritative.resolutionVersion || 1 }
        : authoritative;
      await transaction.runAsync(
        `INSERT INTO local_customers (account_id, customer_id, record_json) VALUES (?, ?, ?)
         ON CONFLICT(account_id, customer_id) DO UPDATE SET record_json=excluded.record_json`,
        accountId, authoritative.id, JSON.stringify(localRecord),
      );
    } else if (!hasDependent) {
      await transaction.runAsync("DELETE FROM local_customers WHERE account_id = ? AND customer_id = ?", accountId, conflict.customerId);
    }
    await transaction.runAsync("INSERT OR IGNORE INTO local_audit (account_id, audit_id, record_json) VALUES (?, ?, ?)", accountId, audit.id, JSON.stringify(audit));
    const original = JSON.parse(conflicted.change_json) as SyncDelta;
    original.customers = original.customers.filter((item) => (item.after || item.before)?.id !== conflict.customerId);
    original.audit = original.audit.filter((item) => !item.action.toLowerCase().includes("customer"));
    const remains = !!original.settings || original.customers.length > 0 || original.entries.length > 0 || original.audit.length > 0 || original.read.length > 0;
    if (remains)
      await transaction.runAsync(
        "UPDATE sync_queue SET change_json = ?, state = 'pending', conflict_json = NULL, last_error = NULL WHERE account_id = ? AND id = ?",
        JSON.stringify(original), accountId, conflict.queueId,
      );
    else await transaction.runAsync("DELETE FROM sync_queue WHERE account_id = ? AND id = ?", accountId, conflict.queueId);
  });
}

export async function refreshConflict(id: number, server: PendingConflict["server"], serverVersion?: number, serverResolutionVersion?: number) {
  const db = await openDatabase();
  if (!db) return;
  const row = await db.getFirstAsync<{ conflict_json: string }>("SELECT conflict_json FROM sync_queue WHERE id = ? AND state = 'conflict'", id);
  if (!row) return;
  const conflict = JSON.parse(row.conflict_json) as PendingConflict;
  conflict.server = server;
  conflict.chosen = undefined;
  conflict.expectedVersion = server?.serverVersion || serverVersion || conflict.expectedVersion;
  conflict.expectedResolutionVersion = server?.resolutionVersion || serverResolutionVersion || conflict.expectedResolutionVersion;
  await db.runAsync("UPDATE sync_queue SET conflict_json = ? WHERE id = ?", JSON.stringify(conflict), id);
}

export async function chooseConflictResolution(id: number, choice: "keep_local" | "keep_server") {
  const db = await openDatabase();
  if (!db) throw new Error("Encrypted offline storage is unavailable");
  const row = await db.getFirstAsync<{ conflict_json: string }>("SELECT conflict_json FROM sync_queue WHERE id = ? AND state = 'conflict'", id);
  if (!row) throw new Error("The pending transaction conflict is unavailable");
  const conflict = JSON.parse(row.conflict_json) as PendingConflict;
  conflict.chosen = choice;
  await db.runAsync("UPDATE sync_queue SET conflict_json = ? WHERE id = ?", JSON.stringify(conflict), id);
  return conflict;
}

export async function completeConflict(accountId: string, conflict: PendingConflict, authoritative: PendingConflict["server"], serverVersion: number, serverResolutionVersion: number, audit: Audit) {
  const db = await openDatabase();
  if (!db) throw new Error("Encrypted offline storage is unavailable");
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const conflictedRow = await transaction.getFirstAsync<{ change_json: string }>(
      "SELECT change_json FROM sync_queue WHERE account_id = ? AND id = ? AND state = 'conflict'",
      accountId, conflict.queueId,
    );
    if (!conflictedRow) return;
    const later = await transaction.getAllAsync<{ id: number; change_json: string }>(
      "SELECT id, change_json FROM sync_queue WHERE account_id = ? AND id > ? AND state = 'pending' ORDER BY id",
      accountId, conflict.queueId,
    );
    let base = authoritative;
    let dependent = false;
    for (const row of later) {
      const change = JSON.parse(row.change_json) as SyncDelta;
      const item = change.entries.find((entry) => (entry.after || entry.before)?.id === conflict.entryId);
      if (!item) continue;
      dependent = true;
      if (item.operation === "update" && item.after && base) {
        item.before = base;
        item.after.serverVersion = base.serverVersion || serverVersion;
        item.after.resolutionVersion = base.resolutionVersion || conflict.expectedResolutionVersion;
        await transaction.runAsync(
          "UPDATE sync_queue SET change_json = ?, base_version = ? WHERE id = ?",
          JSON.stringify(change), base.serverVersion || serverVersion, row.id,
        );
        base = item.after;
      } else if (item.operation === "delete") {
        if (base) {
          item.before = base;
          await transaction.runAsync(
            "UPDATE sync_queue SET change_json = ?, base_version = ? WHERE id = ?",
            JSON.stringify(change), base.serverVersion || serverVersion, row.id,
          );
        }
        base = null;
      } else if (item.after && !base) {
        const nextConflict: PendingConflict = {
          queueId: row.id,
          entryId: conflict.entryId,
          local: item.after!,
          server: null,
          expectedVersion: serverVersion,
          expectedResolutionVersion: serverResolutionVersion,
          resolutionId: Crypto.randomUUID(),
          localDeleted: false,
          localAt: new Date().toISOString(),
        };
        await transaction.runAsync(
          "UPDATE sync_queue SET state = 'conflict', conflict_json = ?, last_error = ? WHERE id = ?",
          JSON.stringify(nextConflict), "Transaction depends on a deleted server record", row.id,
        );
        dependent = true;
      }
    }
    if (authoritative) {
      const cached = await transaction.getFirstAsync<{ record_json: string }>(
        "SELECT record_json FROM local_ledger WHERE account_id = ? AND entry_id = ?",
        accountId, conflict.entryId,
      );
      const localRecord = cached && dependent
        ? { ...JSON.parse(cached.record_json), serverVersion: authoritative.serverVersion || serverVersion, resolutionVersion: authoritative.resolutionVersion || conflict.expectedResolutionVersion }
        : authoritative;
      await transaction.runAsync(
        "UPDATE local_ledger SET customer_id = ?, record_json = ? WHERE account_id = ? AND entry_id = ?",
        localRecord.customerId, JSON.stringify(localRecord), accountId, conflict.entryId,
      );
    } else if (!dependent) {
      await transaction.runAsync("DELETE FROM local_ledger WHERE account_id = ? AND entry_id = ?", accountId, conflict.entryId);
    }
    await transaction.runAsync(
      "INSERT OR IGNORE INTO local_audit (account_id, audit_id, record_json) VALUES (?, ?, ?)",
      accountId, audit.id, JSON.stringify(audit),
    );
    const remaining = JSON.parse(conflictedRow.change_json) as SyncDelta;
    remaining.entries = remaining.entries.filter((item) => (item.after || item.before)?.id !== conflict.entryId);
    remaining.audit = remaining.audit.filter((item) => item.before?.id !== conflict.entryId && item.after?.id !== conflict.entryId);
    const hasRemaining = !!remaining.settings || remaining.customers.length > 0 || remaining.entries.length > 0 || remaining.audit.length > 0 || remaining.read.length > 0;
    if (hasRemaining) {
      await transaction.runAsync(
        "UPDATE sync_queue SET change_json = ?, state = 'pending', conflict_json = NULL, last_error = NULL WHERE account_id = ? AND id = ?",
        JSON.stringify(remaining), accountId, conflict.queueId,
      );
    } else {
      await transaction.runAsync("DELETE FROM sync_queue WHERE account_id = ? AND id = ?", accountId, conflict.queueId);
    }
  });
}

export async function hasPendingChanges(accountId: string) {
  const db = await openDatabase();
  if (!db) return false;
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sync_queue WHERE account_id = ?",
    accountId,
  );
  return (row?.count || 0) > 0;
}

export async function hasUnresolvedConflicts(accountId: string) {
  const db = await openDatabase();
  if (!db) return false;
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sync_queue WHERE account_id = ? AND state = 'conflict'",
    accountId,
  );
  return (row?.count || 0) > 0;
}

export async function hasFailedChanges(accountId: string) {
  const db = await openDatabase();
  if (!db) return false;
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sync_queue WHERE account_id = ? AND state = 'failed'",
    accountId,
  );
  return (row?.count || 0) > 0;
}

export async function nextPendingRetryAt(accountId: string): Promise<number | null> {
  const db = await openDatabase();
  if (!db) return null;
  const row = await db.getFirstAsync<{ retry_at: number | null }>(
    "SELECT MIN(next_attempt_at) AS retry_at FROM sync_queue WHERE account_id = ? AND state = 'pending' AND next_attempt_at > ?",
    accountId,
    Date.now(),
  );
  return row?.retry_at ?? null;
}

export async function acknowledgeChange(
  id: number,
  acknowledged?: { customers?: Customer[]; entries?: Entry[]; settings?: SyncSettings },
) {
  const db = await openDatabase();
  if (!db) return;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{ account_id: string; change_json: string; state: string }>(
      "SELECT account_id, change_json, state FROM sync_queue WHERE id = ?",
      id,
    );
    if (!row || row.state !== "pending") return;
    if (acknowledged?.settings) {
      const authoritative = acknowledged.settings;
      const later = await transaction.getAllAsync<{ id: number; change_json: string }>(
        "SELECT id, change_json FROM sync_queue WHERE account_id = ? AND id > ? AND state = 'pending' ORDER BY id",
        row.account_id, id,
      );
      let hasDependent = false;
      for (const nextRow of later) {
        const next = JSON.parse(nextRow.change_json) as SyncDelta;
        if (!next.settings) continue;
        next.settings.before = authoritative;
        next.settings.after.shop.serverVersion = authoritative.shop.serverVersion;
        next.settings.after.shop.resolutionVersion = authoritative.shop.resolutionVersion;
        await transaction.runAsync(
          "UPDATE sync_queue SET change_json = ?, base_version = ? WHERE id = ?",
          JSON.stringify(next), authoritative.shop.serverVersion || 1, nextRow.id,
        );
        hasDependent = true;
        break;
      }
      const account = await transaction.getFirstAsync<{ shop_json: string; preferences_json: string }>(
        "SELECT shop_json, preferences_json FROM local_accounts WHERE account_id = ?",
        row.account_id,
      );
      if (account) {
        const oldShop = JSON.parse(account.shop_json);
        const oldPreferences = JSON.parse(account.preferences_json);
        await transaction.runAsync(
          "UPDATE local_accounts SET shop_json = ?, preferences_json = ?, updated_at = ? WHERE account_id = ?",
          JSON.stringify(hasDependent ? { ...oldShop, serverVersion: authoritative.shop.serverVersion, resolutionVersion: authoritative.shop.resolutionVersion } : authoritative.shop),
          JSON.stringify(hasDependent ? oldPreferences : {
            ...oldPreferences,
            language: authoritative.language,
            defaultMethod: authoritative.defaultMethod,
            reminders: authoritative.reminders,
          }),
          Date.now(), row.account_id,
        );
      }
    }
    for (const [kind, records] of [
      ["customer", acknowledged?.customers || []],
      ["entry", acknowledged?.entries || []],
    ] as const) {
      for (const authoritative of records) {
        const entityId = authoritative.id;
        const nextRows = await transaction.getAllAsync<{ id: number; change_json: string }>(
          "SELECT id, change_json FROM sync_queue WHERE account_id = ? AND id > ? AND state = 'pending' ORDER BY id",
          row.account_id, id,
        );
        let rebasedNext = false;
        for (const nextRow of nextRows) {
          const next = JSON.parse(nextRow.change_json) as SyncDelta;
          const list = kind === "customer" ? next.customers : next.entries;
          const item = list.find((candidate) => (candidate.after || candidate.before)?.id === entityId);
          if (!item) continue;
        item.before = authoritative as never;
        if (item.after) item.after.serverVersion = authoritative.serverVersion;
        if (item.after) item.after.resolutionVersion = authoritative.resolutionVersion;
          await transaction.runAsync(
            "UPDATE sync_queue SET change_json = ?, base_version = ? WHERE id = ?",
            JSON.stringify(next), authoritative.serverVersion || 1, nextRow.id,
          );
          rebasedNext = true;
          break;
        }
        const table = kind === "customer" ? "local_customers" : "local_ledger";
        const idColumn = kind === "customer" ? "customer_id" : "entry_id";
        const cached = await transaction.getFirstAsync<{ record_json: string }>(
          `SELECT record_json FROM ${table} WHERE account_id = ? AND ${idColumn} = ?`,
          row.account_id, entityId,
        );
        if (cached) {
          const current = JSON.parse(cached.record_json) as Customer | Entry;
          const nextRecord = rebasedNext
            ? { ...current, serverVersion: authoritative.serverVersion, resolutionVersion: authoritative.resolutionVersion }
            : authoritative;
          await transaction.runAsync(
            `UPDATE ${table} SET record_json = ? WHERE account_id = ? AND ${idColumn} = ?`,
            JSON.stringify(nextRecord), row.account_id, entityId,
          );
        }
      }
    }
    await transaction.runAsync("DELETE FROM sync_queue WHERE account_id = ? AND id = ?", row.account_id, id);
  });
}

export async function noteSyncFailure(id: number, error: unknown) {
  const db = await openDatabase();
  if (db) {
    const prior = await db.getFirstAsync<{ attempts: number }>(
      "SELECT attempts FROM sync_queue WHERE id = ?",
      id,
    );
    const retryDelay = Math.min(6 * 60 * 60 * 1000, 5000 * 2 ** Math.min(prior?.attempts || 0, 12));
    const message =
      error instanceof Error && error.name === "ApiError"
        ? error.message.slice(0, 300)
        : error instanceof Error && error.name === "ApiTransportError"
          ? error.message
          : "Synchronization failed";
    await db.runAsync(
      "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id = ?",
      message,
      Date.now() + retryDelay,
      id,
    );
  }
}

export async function markSyncFailurePermanent(id: number) {
  const db = await openDatabase();
  if (db)
    await db.runAsync(
      "UPDATE sync_queue SET state = 'failed' WHERE id = ? AND state = 'pending'",
      id,
    );
}

export async function readSyncQueueStatus(
  accountId: string,
): Promise<SyncQueueStatus> {
  const db = await openDatabase();
  if (!db) throw new Error("Encrypted offline storage is unavailable");
  const rows = await db.getAllAsync<{ state: string; count: number }>(
    "SELECT state, COUNT(*) AS count FROM sync_queue WHERE account_id = ? GROUP BY state",
    accountId,
  );
  const counts = new Map(rows.map((row) => [row.state, row.count]));
  return {
    pending: counts.get("pending") || 0,
    failed: counts.get("failed") || 0,
    conflicts: counts.get("conflict") || 0,
  };
}

export async function retryFailedChanges(accountId: string) {
  const db = await openDatabase();
  if (!db) throw new Error("Encrypted offline storage is unavailable");
  const result = await db.runAsync(
      "UPDATE sync_queue SET state = 'pending', last_error = NULL, next_attempt_at = 0 WHERE account_id = ? AND state = 'failed'",
    accountId,
  );
  return result.changes;
}

export async function clearOfflineAccount(accountId: string) {
  const db = await openDatabase();
  if (db)
    await db.withExclusiveTransactionAsync(async (transaction) => {
      for (const table of ["local_accounts", "local_customers", "local_ledger", "local_audit", "local_subscription_cache", "sync_queue"])
        await transaction.runAsync(`DELETE FROM ${table} WHERE account_id = ?`, accountId);
    });
  await SecureStore.deleteItemAsync(OFFLINE_SESSION);
}

export async function clearOfflineSession() {
  await SecureStore.deleteItemAsync(OFFLINE_SESSION);
}

export async function rotateOfflineSessionToken(
  previousToken: string,
  nextToken: string,
) {
  const raw = await SecureStore.getItemAsync(OFFLINE_SESSION);
  if (!raw) return;
  try {
    const session = JSON.parse(raw) as OfflineSession;
    const previousHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      previousToken,
    );
    if (session.refreshTokenHash !== previousHash) return;
    session.refreshTokenHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      nextToken,
    );
    session.authenticatedAt = Date.now();
    await SecureStore.setItemAsync(OFFLINE_SESSION, JSON.stringify(session));
  } catch {
    await clearOfflineSession();
  }
}
