import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import type * as SQLiteTypes from "expo-sqlite";
import type { Audit, Data } from "./model";
import { createSyncDelta, type SyncDelta } from "./syncDelta";

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
export type PendingConflict = {
  queueId: number;
  entryId: string;
  local: NonNullable<SyncDelta["entries"][number]["after"]>;
  server: NonNullable<SyncDelta["entries"][number]["after"]> | null;
  expectedVersion: number;
  resolutionId: string;
  localDeleted: boolean;
  localAt: string;
  chosen?: "keep_local" | "keep_server";
};

export const offlineStorageAvailable = () =>
  Constants.appOwnership !== "expo" && !nativeDatabaseUnavailable;

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
      if (currentVersion > 3)
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
          conflict_json TEXT
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
      if (currentVersion < 3) await db.execAsync("PRAGMA user_version = 3;");
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
    const inserted = await transaction.runAsync(
      `INSERT INTO sync_queue (account_id, previous_json, next_json, change_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      accountId,
      "{}",
      "{}",
      JSON.stringify(change),
      Date.now(),
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
  const conflicts = await db.getAllAsync<{ conflict_json: string }>(
    "SELECT conflict_json FROM sync_queue WHERE account_id = ? AND state = 'conflict' AND conflict_json IS NOT NULL",
    accountId,
  );
  const blocked = new Set<string>();
  for (const item of conflicts) {
    try { blocked.add((JSON.parse(item.conflict_json) as PendingConflict).entryId); } catch { /* Ignore corrupt metadata; queue remains intact. */ }
  }
  const pending = await db.getAllAsync<{ id: number; change_json: string }>(
    "SELECT id, change_json FROM sync_queue WHERE account_id = ? AND state = 'pending' ORDER BY id",
    accountId,
  );
  for (const item of pending) {
    const change = JSON.parse(item.change_json) as SyncDelta;
    if (change.entries.some((entry) => blocked.has((entry.after || entry.before)!.id))) continue;
    return { id: item.id, change };
  }
  return null;
}

export async function markConflict(
  id: number,
  change: SyncDelta,
  server: PendingConflict["server"],
  serverVersion?: number,
) {
  const db = await openDatabase();
  if (!db) return;
  const operation = change.entries.find((item) => item.operation === "update" || item.operation === "delete");
  if (!operation) return;
  const local = operation.after || operation.before!;
  const localAudit = change.audit.find((item) => item.after?.id === local.id || item.before?.id === local.id);
  const conflict: PendingConflict = {
    queueId: id,
    entryId: local.id,
    local,
    server,
    expectedVersion: server?.serverVersion || serverVersion || local.serverVersion || 1,
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

export async function readPendingConflicts(accountId: string): Promise<PendingConflict[]> {
  const db = await openDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<{ conflict_json: string }>(
    "SELECT conflict_json FROM sync_queue WHERE account_id = ? AND state = 'conflict' AND conflict_json IS NOT NULL ORDER BY id",
    accountId,
  );
  return rows.flatMap((row) => { try { return [JSON.parse(row.conflict_json) as PendingConflict]; } catch { return []; } });
}

export async function refreshConflict(id: number, server: PendingConflict["server"], serverVersion?: number) {
  const db = await openDatabase();
  if (!db) return;
  const row = await db.getFirstAsync<{ conflict_json: string }>("SELECT conflict_json FROM sync_queue WHERE id = ? AND state = 'conflict'", id);
  if (!row) return;
  const conflict = JSON.parse(row.conflict_json) as PendingConflict;
  conflict.server = server;
  conflict.chosen = undefined;
  conflict.expectedVersion = server?.serverVersion || serverVersion || conflict.expectedVersion;
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

export async function completeConflict(accountId: string, conflict: PendingConflict, authoritative: PendingConflict["server"], serverVersion: number, audit: Audit) {
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
        change.entries[change.entries.indexOf(item)] = item;
        await transaction.runAsync("UPDATE sync_queue SET change_json = ? WHERE id = ?", JSON.stringify(change), row.id);
        base = item.after;
      } else if (item.operation === "delete") {
        if (base) item.before = base;
        await transaction.runAsync("UPDATE sync_queue SET change_json = ? WHERE id = ?", JSON.stringify(change), row.id);
        base = null;
      } else if (item.operation === "update" && !base) {
        const nextConflict: PendingConflict = {
          queueId: row.id,
          entryId: conflict.entryId,
          local: item.after!,
          server: null,
          expectedVersion: serverVersion,
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
    if (!dependent) {
      if (authoritative) await transaction.runAsync(
        "UPDATE local_ledger SET customer_id = ?, record_json = ? WHERE account_id = ? AND entry_id = ?",
        authoritative.customerId, JSON.stringify(authoritative), accountId, conflict.entryId,
      );
      else await transaction.runAsync("DELETE FROM local_ledger WHERE account_id = ? AND entry_id = ?", accountId, conflict.entryId);
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

export async function acknowledgeChange(id: number) {
  const db = await openDatabase();
  if (db) await db.runAsync("DELETE FROM sync_queue WHERE id = ?", id);
}

export async function noteSyncFailure(id: number, error: unknown) {
  const db = await openDatabase();
  if (db)
    await db.runAsync(
      "UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?",
      error instanceof Error ? error.message.slice(0, 500) : "Synchronization failed",
      id,
    );
}

export async function clearOfflineAccount(accountId: string) {
  const db = await openDatabase();
  if (db)
    await db.withExclusiveTransactionAsync(async (transaction) => {
      for (const table of ["local_accounts", "local_customers", "local_ledger", "local_audit", "sync_queue"])
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
