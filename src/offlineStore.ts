import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system/legacy";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type * as SQLiteTypes from "expo-sqlite";
import type { Audit, Customer, Data, Entry } from "./model";
import { createSyncDelta, normalizeSyncDelta, type SyncDelta, type SyncSettings } from "./syncDelta";
import { withoutLegacyDue, withoutLegacyDueFromAudit } from "./ledgerCompatibility";
import { normalizeCustomerMobile } from "./customerPhone";
import { normalizeCustomerLifecycle } from "./customerLifecycle";
import { authorizeReceiptAccess, type ReceiptSnapshot } from "./transactionReceipt";
import { deletedEntriesFromHistory } from "./transactionLifecycle";

const DATABASE = "digital-khata-offline.db";
const KEY_NAME = "khata.sqlite.key.v1";
const OFFLINE_SESSION = "khata.offline-session.v1";
const OFFLINE_SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const parseQueuedChange = (raw: string) => normalizeSyncDelta(JSON.parse(raw) as SyncDelta);
const normalizeLegacyConflict = (conflict: PendingConflict): PendingConflict => ({
  ...conflict,
  local: withoutLegacyDue(conflict.local) as Entry,
  server: conflict.server ? withoutLegacyDue(conflict.server) as Entry : null,
});
let database: Promise<SQLiteTypes.SQLiteDatabase | null> | null = null;
let databaseEncryptionKey: string | null = null;
let nativeDatabaseUnavailable = false;
let databaseStatus: "not_checked" | "opening" | "ready" | "unavailable" = "not_checked";
type OfflineDatabaseStage = "not_started" | "native_module" | "database_file_check" | "secure_key_read" | "secure_key_write" | "database_open" | "sqlcipher_check" | "key_apply" | "encryption_verify" | "migration" | "ready" | "failed";
type OfflineDatabaseErrorCategory = "none" | "native_module_unavailable" | "secure_store_unavailable" | "existing_database_key_missing" | "invalid_key_metadata" | "database_open_failed" | "sqlcipher_unavailable" | "key_or_database_invalid" | "migration_failed" | "database_version_unsupported" | "unknown";
let databaseDiagnostics = {
  stage: "not_started" as OfflineDatabaseStage,
  nativeSQLiteAvailable: false,
  sqlCipherSupported: null as boolean | null,
  secureKeyExists: null as boolean | null,
  secureKeyReadSucceeded: null as boolean | null,
  databaseOpenSucceeded: null as boolean | null,
  encryptionVerified: null as boolean | null,
  migrationSucceeded: null as boolean | null,
  errorCategory: "none" as OfflineDatabaseErrorCategory,
  errorMessage: "",
};

function sanitizedStorageError(error: unknown) {
  const message = error instanceof Error ? error.message : "Storage operation failed";
  const lower = message.toLowerCase();
  let category: OfflineDatabaseErrorCategory = "unknown";
  if (/existing encrypted database key is missing/.test(lower)) category = "existing_database_key_missing";
  else if (/invalid stored encryption key|invalid key format/.test(lower)) category = "invalid_key_metadata";
  else if (/sqlcipher.*unavailable/.test(lower)) category = "sqlcipher_unavailable";
  else if (/not a database|malformed|file is encrypted|cipher.*(key|decrypt)/.test(lower)) category = "key_or_database_invalid";
  else if (/newer than this app|unsupported.*version/.test(lower)) category = "database_version_unsupported";
  else if (/securestore|keystore|keychain|biometric|authentication required/.test(lower)) category = "secure_store_unavailable";
  else if (/no such module|native module|expo.?sqlite/.test(lower)) category = "native_module_unavailable";
  else if (/unable to open|cannot open|disk i\/o|readonly|permission denied/.test(lower)) category = "database_open_failed";
  else if (/syntax error|duplicate column|migration|unique constraint/.test(lower)) category = "migration_failed";
  const messages: Record<OfflineDatabaseErrorCategory, string> = {
    none: "", native_module_unavailable: "Encrypted SQLite is unavailable in this app build. Install a native preview or production build.",
    secure_store_unavailable: "Android secure key storage could not be accessed. Existing local data was preserved.",
    existing_database_key_missing: "The existing database key is missing from Android secure storage. Local data was preserved; no replacement key was generated.",
    invalid_key_metadata: "The stored encryption key is invalid. Existing local data was preserved.",
    database_open_failed: "The local database file could not be opened. Existing local data was preserved.",
    sqlcipher_unavailable: "SQLCipher support is missing from this installed app build. Install a native build configured with SQLCipher.",
    key_or_database_invalid: "The database could not be decrypted or read. Existing local data was preserved.",
    migration_failed: "A local database migration could not be completed. Existing local data was preserved.",
    database_version_unsupported: "This local database was created by a newer app version. Update the app to continue.",
    unknown: "Encrypted local storage initialization failed. Existing local data was preserved.",
  };
  return { category, message: messages[category] };
}

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
  mobileConflicts: number;
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
  lifecycleChange?: boolean;
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

export function offlineStorageReadiness() {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient)
    return "unsupported" as const;
  if (nativeDatabaseUnavailable) return "unsupported" as const;
  return databaseStatus;
}

export function offlineStorageDiagnostics() {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  return {
    ...databaseDiagnostics,
    readiness: offlineStorageReadiness(),
    buildProfile: typeof extra?.buildProfile === "string" ? extra.buildProfile : "unknown",
    appMode: typeof extra?.appMode === "string" ? extra.appMode : "unknown",
  };
}

/** User-initiated retry that never removes or recreates the database or key. */
export async function retryOfflineStorageInitialization() {
  if (databaseStatus === "ready") return true;
  database = null;
  databaseStatus = "not_checked";
  nativeDatabaseUnavailable = false;
  databaseDiagnostics = { ...databaseDiagnostics, stage: "not_started", errorCategory: "none", errorMessage: "" };
  return Boolean(await openDatabase());
}

async function runMigrations(db: SQLiteTypes.SQLiteDatabase) {
  const currentVersion =
    (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version || 0;
  if (currentVersion > 6) throw new Error("Offline database version is newer than this app");
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await withEncryptedTransaction(db, async (tx) => {
    await tx.execAsync(`
      CREATE TABLE IF NOT EXISTS local_accounts (
        account_id TEXT PRIMARY KEY NOT NULL, shop_json TEXT NOT NULL,
        preferences_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_customers (
        account_id TEXT NOT NULL, customer_id TEXT NOT NULL, record_json TEXT NOT NULL,
        PRIMARY KEY (account_id, customer_id)
      );
      CREATE TABLE IF NOT EXISTS local_ledger (
        account_id TEXT NOT NULL, entry_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        record_json TEXT NOT NULL, PRIMARY KEY (account_id, entry_id)
      );
      CREATE INDEX IF NOT EXISTS local_ledger_customer_idx ON local_ledger (account_id, customer_id);
      CREATE TABLE IF NOT EXISTS local_audit (
        account_id TEXT NOT NULL, audit_id TEXT NOT NULL, record_json TEXT NOT NULL,
        PRIMARY KEY (account_id, audit_id)
      );
      CREATE TABLE IF NOT EXISTS local_subscription_cache (
        account_id TEXT PRIMARY KEY NOT NULL, snapshot_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, previous_json TEXT,
        next_json TEXT, change_json TEXT NOT NULL, created_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
        state TEXT NOT NULL DEFAULT 'pending', conflict_json TEXT, operation_id TEXT,
        entity_type TEXT, entity_id TEXT, base_version INTEGER,
        next_attempt_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS sync_queue_account_order_idx ON sync_queue (account_id, id);
    `);
    const columns = await tx.getAllAsync<{ name: string }>("PRAGMA table_info(sync_queue)");
    const names = new Set(columns.map((column) => column.name));
    for (const [name, definition] of [
      ["change_json", "TEXT"], ["state", "TEXT NOT NULL DEFAULT 'pending'"],
      ["conflict_json", "TEXT"], ["operation_id", "TEXT"], ["entity_type", "TEXT"],
      ["entity_id", "TEXT"], ["base_version", "INTEGER"],
      ["next_attempt_at", "INTEGER NOT NULL DEFAULT 0"],
    ] as const) {
      if (!names.has(name)) await tx.execAsync(`ALTER TABLE sync_queue ADD COLUMN ${name} ${definition}`);
    }
    if (names.has("previous_json") && names.has("next_json")) {
      const legacy = await tx.getAllAsync<{ id: number; previous_json: string; next_json: string }>(
        "SELECT id, previous_json, next_json FROM sync_queue WHERE change_json IS NULL",
      );
      for (const row of legacy) {
        const change = createSyncDelta(JSON.parse(row.previous_json), JSON.parse(row.next_json));
        await tx.runAsync("UPDATE sync_queue SET change_json = ? WHERE id = ?", JSON.stringify(change), row.id);
      }
    }
    if (currentVersion < 5) {
      const queue = await tx.getAllAsync<{ id: number; operation_id: string | null }>(
        "SELECT id, operation_id FROM sync_queue WHERE operation_id IS NULL",
      );
      for (const row of queue)
        await tx.runAsync("UPDATE sync_queue SET operation_id = ? WHERE id = ?", Crypto.randomUUID(), row.id);
      await tx.execAsync("CREATE UNIQUE INDEX IF NOT EXISTS sync_queue_operation_id_idx ON sync_queue (operation_id)");
      await tx.execAsync("PRAGMA user_version = 5;");
    }
    if (currentVersion < 6) {
      const customerRows = await tx.getAllAsync<{ account_id: string; customer_id: string; record_json: string }>(
        "SELECT account_id, customer_id, record_json FROM local_customers",
      );
      for (const row of customerRows) {
        const normalized = normalizeCustomerLifecycle(JSON.parse(row.record_json));
        await tx.runAsync(
          "UPDATE local_customers SET record_json = ? WHERE account_id = ? AND customer_id = ?",
          JSON.stringify(normalized), row.account_id, row.customer_id,
        );
      }
      const queuedRows = await tx.getAllAsync<{ id: number; change_json: string }>(
        "SELECT id, change_json FROM sync_queue WHERE change_json IS NOT NULL",
      );
      for (const row of queuedRows) {
        const change = normalizeSyncDelta(JSON.parse(row.change_json) as SyncDelta);
        await tx.runAsync("UPDATE sync_queue SET change_json = ? WHERE id = ?", JSON.stringify(change), row.id);
      }
      await tx.execAsync("PRAGMA user_version = 6;");
    }
  });
}

/** Expo's exclusive transaction helper opens a new connection. SQLCipher keys are
 * connection-scoped, so every such connection must receive the key before BEGIN
 * or any query. This preserves transaction isolation without using an unkeyed
 * connection against the encrypted database. */
async function withEncryptedTransaction<T>(
  _databaseHandle: SQLiteTypes.SQLiteDatabase,
  task: (transaction: SQLiteTypes.SQLiteDatabase) => Promise<T>,
): Promise<T> {
  if (!databaseEncryptionKey) throw new Error("Encrypted database key is not initialized");
  const SQLite = await import("expo-sqlite");
  const transaction = await SQLite.openDatabaseAsync(DATABASE, { useNewConnection: true });
  let began = false;
  try {
    await transaction.execAsync(`PRAGMA key = "x'${databaseEncryptionKey}'";`);
    const cipher = await transaction.getFirstAsync<{ cipher_version: string }>("PRAGMA cipher_version");
    if (!cipher?.cipher_version) throw new Error("SQLCipher is unavailable on transaction connection");
    await transaction.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master LIMIT 1");
    await transaction.execAsync("BEGIN IMMEDIATE;");
    began = true;
    const result = await task(transaction);
    await transaction.execAsync("COMMIT;");
    began = false;
    return result;
  } catch (error) {
    if (began) {
      try { await transaction.execAsync("ROLLBACK;"); } catch { /* Preserve the triggering error. */ }
    }
    throw error;
  } finally {
    try { await transaction.closeAsync(); } catch { /* Do not mask commit or task results. */ }
  }
}

async function openDatabase() {
  if (!offlineStorageAvailable()) return null;
  if (!database) {
    databaseStatus = "opening";
    database = (async () => {
      let SQLite: typeof import("expo-sqlite");
      try {
        SQLite = await import("expo-sqlite");
        databaseDiagnostics = { ...databaseDiagnostics, stage: "native_module", nativeSQLiteAvailable: true };
      } catch (error) {
        nativeDatabaseUnavailable = true;
        databaseStatus = "unavailable";
        databaseDiagnostics = { ...databaseDiagnostics, stage: "failed", nativeSQLiteAvailable: false,
          errorCategory: "native_module_unavailable", errorMessage: sanitizedStorageError(error).message };
        return null;
      }
      databaseDiagnostics = { ...databaseDiagnostics, stage: "sqlcipher_check" };
      try {
        const probe = await SQLite.openDatabaseAsync(":memory:", { useNewConnection: true });
        try {
          const cipher = await probe.getFirstAsync<{ cipher_version: string }>("PRAGMA cipher_version");
          databaseDiagnostics = { ...databaseDiagnostics, sqlCipherSupported: Boolean(cipher?.cipher_version) };
          if (!cipher?.cipher_version) {
            nativeDatabaseUnavailable = true;
            throw new Error("SQLCipher is unavailable in the installed app build");
          }
        } finally {
          await probe.closeAsync();
        }
      } catch (error) {
        const cipherMissing = !databaseDiagnostics.sqlCipherSupported;
        databaseDiagnostics = { ...databaseDiagnostics, stage: "failed",
          errorCategory: cipherMissing ? "sqlcipher_unavailable" : "native_module_unavailable",
          errorMessage: sanitizedStorageError(new Error(cipherMissing ? "SQLCipher unavailable" : "native SQLite unavailable")).message };
        if (cipherMissing) nativeDatabaseUnavailable = true;
        throw error;
      }
      let databaseFileExists = false;
      databaseDiagnostics = { ...databaseDiagnostics, stage: "database_file_check" };
      try {
        const directory = SQLite.defaultDatabaseDirectory;
        if (typeof directory !== "string" || !directory) throw new Error("SQLite database directory unavailable");
        const uri = `file://${directory.replace(/\/$/, "")}/${DATABASE}`;
        databaseFileExists = (await FileSystem.getInfoAsync(uri)).exists;
      } catch (error) {
        const safe = sanitizedStorageError(error);
        databaseDiagnostics = { ...databaseDiagnostics, stage: "failed", errorCategory: safe.category, errorMessage: safe.message };
        throw error;
      }
      let key: string | null;
      databaseDiagnostics = { ...databaseDiagnostics, stage: "secure_key_read" };
      try {
        key = await SecureStore.getItemAsync(KEY_NAME);
        databaseDiagnostics = { ...databaseDiagnostics, secureKeyReadSucceeded: true, secureKeyExists: Boolean(key) };
      } catch (error) {
        databaseDiagnostics = { ...databaseDiagnostics, stage: "failed", secureKeyReadSucceeded: false,
          errorCategory: "secure_store_unavailable", errorMessage: sanitizedStorageError(error).message };
        throw error;
      }
      if (!key) {
        if (databaseFileExists) {
          databaseDiagnostics = { ...databaseDiagnostics, stage: "failed", secureKeyExists: false,
            errorCategory: "existing_database_key_missing",
            errorMessage: sanitizedStorageError(new Error("Existing encrypted database key is missing")).message };
          throw new Error("Existing encrypted database key is missing");
        }
        databaseDiagnostics = { ...databaseDiagnostics, stage: "secure_key_write" };
        const bytes = await Crypto.getRandomBytesAsync(32);
        const newKey = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        try {
          await SecureStore.setItemAsync(KEY_NAME, newKey);
          key = await SecureStore.getItemAsync(KEY_NAME);
          if (key !== newKey) throw new Error("Secure key persistence could not be confirmed");
          databaseEncryptionKey = key;
          databaseDiagnostics = { ...databaseDiagnostics, secureKeyExists: true, secureKeyReadSucceeded: true };
        } catch (error) {
          databaseDiagnostics = { ...databaseDiagnostics, stage: "failed", errorCategory: "secure_store_unavailable",
            errorMessage: sanitizedStorageError(error).message };
          throw error;
        }
      }
      if (!/^[0-9a-f]{64}$/i.test(key)) {
        databaseDiagnostics = { ...databaseDiagnostics, stage: "failed", errorCategory: "invalid_key_metadata",
          errorMessage: sanitizedStorageError(new Error("Invalid stored encryption key format")).message };
        throw new Error("Invalid stored encryption key format");
      }
      databaseEncryptionKey = key;
      let db: SQLiteTypes.SQLiteDatabase | null = null;
      try {
        databaseDiagnostics = { ...databaseDiagnostics, stage: "database_open" };
        db = await SQLite.openDatabaseAsync(DATABASE);
        databaseDiagnostics = { ...databaseDiagnostics, databaseOpenSucceeded: true, stage: "key_apply" };
        // SQLCipher requires the key before the first database access on this connection.
        await db.execAsync(`PRAGMA key = "x'${key}'";`);
        databaseDiagnostics = { ...databaseDiagnostics, stage: "sqlcipher_check" };
        const cipher = await db.getFirstAsync<{ cipher_version: string }>("PRAGMA cipher_version");
        databaseDiagnostics = { ...databaseDiagnostics, sqlCipherSupported: Boolean(cipher?.cipher_version) };
        if (!cipher?.cipher_version) {
          nativeDatabaseUnavailable = true;
          throw new Error("SQLCipher is unavailable in the installed app build");
        }
        databaseDiagnostics = { ...databaseDiagnostics, stage: "encryption_verify" };
        await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master LIMIT 1");
        databaseDiagnostics = { ...databaseDiagnostics, encryptionVerified: true, stage: "migration" };
        await runMigrations(db);
        databaseDiagnostics = { ...databaseDiagnostics, migrationSucceeded: true, stage: "ready",
          errorCategory: "none", errorMessage: "" };
      } catch (error) {
        try { await db?.closeAsync(); } catch { /* Keep the original initialization error. */ }
        const failedAtStage = databaseDiagnostics.stage;
        const safe = sanitizedStorageError(error);
        const cipherMissing = failedAtStage === "sqlcipher_check" && !databaseDiagnostics.sqlCipherSupported;
        const stageCategory = failedAtStage === "database_open" ? "database_open_failed"
          : failedAtStage === "key_apply" || failedAtStage === "encryption_verify" ? "key_or_database_invalid"
            : failedAtStage === "migration" ? "migration_failed" : safe.category;
        databaseDiagnostics = { ...databaseDiagnostics, stage: "failed",
          errorCategory: cipherMissing ? "sqlcipher_unavailable" : stageCategory,
          errorMessage: cipherMissing ? sanitizedStorageError(new Error("SQLCipher is unavailable")).message : safe.message,
          encryptionVerified: databaseDiagnostics.encryptionVerified === true ? true
            : failedAtStage === "encryption_verify" ? false : databaseDiagnostics.encryptionVerified,
          migrationSucceeded: failedAtStage === "migration" ? false : databaseDiagnostics.migrationSucceeded };
        throw error;
      }
      databaseStatus = "ready";
      return db;
    })().catch((error) => {
      if (databaseStatus !== "unavailable") databaseStatus = "unavailable";
      if (databaseDiagnostics.stage !== "failed") {
        const safe = sanitizedStorageError(error);
        databaseDiagnostics = { ...databaseDiagnostics, stage: "failed", errorCategory: safe.category, errorMessage: safe.message };
      }
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
    deletedEntries: data.deletedEntries || deletedEntriesFromHistory(data.audit, data.entries),
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
      JSON.stringify(normalizeCustomerLifecycle(customer)),
    );
  for (const entry of [...data.entries].reverse())
    await db.runAsync(
      "INSERT INTO local_ledger (account_id, entry_id, customer_id, record_json) VALUES (?, ?, ?, ?)",
      accountId,
      entry.id,
      entry.customerId,
      JSON.stringify(withoutLegacyDue(entry)),
    );
  for (const audit of [...data.audit].reverse())
    await db.runAsync(
      "INSERT INTO local_audit (account_id, audit_id, record_json) VALUES (?, ?, ?)",
      accountId,
      audit.id,
      JSON.stringify(withoutLegacyDueFromAudit(audit)),
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
      JSON.stringify(normalizeCustomerLifecycle(record)),
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
        JSON.stringify(withoutLegacyDue(record)),
      );
  }
  for (const audit of change.audit)
    await db.runAsync(
      "INSERT OR IGNORE INTO local_audit (account_id, audit_id, record_json) VALUES (?, ?, ?)",
      accountId,
      audit.id,
      JSON.stringify(withoutLegacyDueFromAudit(audit)),
    );
}

export async function cacheAuthenticatedAccount(accountId: string, data: Data) {
  if (!offlineStorageAvailable()) return;
  const db = await openDatabase();
  if (!db) return;
  await withEncryptedTransaction(db, async (transaction) => {
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
  await withEncryptedTransaction(db, async (transaction) => {
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
  recordedAtAuthority?: "server",
) {
  const db = await openDatabase();
  if (!db) return null;
  let queueId: number | null = null;
  await withEncryptedTransaction(db, async (transaction) => {
    const delta = createSyncDelta(previous, next);
    const change = normalizeSyncDelta({
      ...delta,
      ...(recordedAtAuthority && delta.entries.some((item) => item.operation === "create")
        ? { recordedAtAuthority }
        : {}),
    });
    const changedCustomerIds = new Set(change.customers.map((item) => (item.after || item.before)?.id).filter(Boolean));
    const seenMobiles = new Map<string, string>();
    for (const customer of next.customers) {
      const mobile = normalizeCustomerMobile(customer.phone);
      if (!mobile) continue;
      const prior = seenMobiles.get(mobile);
      if (prior && prior !== customer.id && (changedCustomerIds.has(prior) || changedCustomerIds.has(customer.id)))
        throw Object.assign(new Error("A customer with this mobile number already exists in this shop"), { code: "CUSTOMER_MOBILE_ALREADY_EXISTS" });
      seenMobiles.set(mobile, customer.id);
    }
    await writeChange(transaction, accountId, next, change);
    const changedCustomer = change.customers.find((item) => item.after);
    if (changedCustomer?.after) {
      const failedCreate = await transaction.getFirstAsync<{ id: number; change_json: string }>(
        `SELECT id, change_json FROM sync_queue
         WHERE account_id = ? AND state = 'failed' AND last_error LIKE 'CUSTOMER_MOBILE_ALREADY_EXISTS:%'
           AND entity_type = 'customer' AND entity_id = ? ORDER BY id LIMIT 1`,
        accountId, changedCustomer.after.id,
      );
      if (failedCreate) {
        const original = parseQueuedChange(failedCreate.change_json);
        const originalCustomer = original.customers.find((item) => (item.after || item.before)?.id === changedCustomer.after!.id);
        if (originalCustomer) {
          originalCustomer.after = { ...changedCustomer.after };
          original.audit = [...new Map([...original.audit, ...change.audit].map((item) => [item.id, item])).values()];
          await transaction.runAsync(
            "UPDATE sync_queue SET change_json = ?, state = 'pending', last_error = NULL, next_attempt_at = 0 WHERE id = ?",
            JSON.stringify(original), failedCreate.id,
          );
          queueId = failedCreate.id;
        }
      }
    }
    if (queueId !== null) return;
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
      JSON.stringify(normalizeSyncDelta(change)),
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
  const auditRecords = audit.map((row) => withoutLegacyDueFromAudit(JSON.parse(row.record_json)));
  const entryRecords = entries.map((row) => withoutLegacyDue(JSON.parse(row.record_json)) as Entry);
  return {
    shop: JSON.parse(account.shop_json),
    customers: customers.map((row) => normalizeCustomerLifecycle(JSON.parse(row.record_json))),
    entries: entryRecords,
    audit: auditRecords,
    ...preferences,
    deletedEntries: preferences.deletedEntries || deletedEntriesFromHistory(auditRecords, entryRecords),
  } as Data;
}

/** Read-only, consistent export snapshot. Reuses the existing offline authorization policy. */
export async function readReceiptSnapshot(
  accountId: string,
  options: { authenticatedData?: Data; allowMissingOfflineSession?: boolean } = {},
): Promise<ReceiptSnapshot> {
  const session = await readOfflineSession().catch((error) => {
    if (options.authenticatedData && options.allowMissingOfflineSession) return null;
    throw error;
  });
  const accountData = options.authenticatedData;
  if (!accountData && !session) throw new Error("Your offline authorization has expired. Sign in again before exporting a receipt.");
  if (accountData) {
    authorizeReceiptAccess(accountData, accountId, session, !options.allowMissingOfflineSession);
  } else if (session?.accountId !== accountId) {
    throw new Error("The offline session belongs to a different shop.");
  }
  let db: SQLiteTypes.SQLiteDatabase | null;
  try { db = await openDatabase(); }
  catch (error) {
    if (!accountData) throw error;
    db = null;
  }
  if (!db) {
    if (!accountData) throw new Error("Encrypted local storage is unavailable. Reopen the app in a supported Android build.");
    const currentSession = await readOfflineSession().catch((error) => {
      if (options.authenticatedData && options.allowMissingOfflineSession) return null;
      throw error;
    });
    if (session && (!currentSession || currentSession.accountId !== session.accountId))
      throw new Error("The account session changed. Reopen the transaction.");
    return { accountId, data: accountData, queue: [], queueAvailable: false };
  }
  const snapshot = await withEncryptedTransaction(db, async (tx) => {
    const account = await tx.getFirstAsync<{ shop_json: string; preferences_json: string }>(
      "SELECT shop_json, preferences_json FROM local_accounts WHERE account_id = ?", accountId,
    );
    if (!account) {
      if (accountData) return { accountId, data: accountData, queue: [], queueAvailable: false };
      throw new Error("Shop details are not available in the local cache.");
    }
    const customers = await tx.getAllAsync<{ record_json: string }>("SELECT record_json FROM local_customers WHERE account_id = ? ORDER BY rowid", accountId);
    const entries = await tx.getAllAsync<{ record_json: string }>("SELECT record_json FROM local_ledger WHERE account_id = ? ORDER BY rowid", accountId);
    const audit = await tx.getAllAsync<{ record_json: string }>("SELECT record_json FROM local_audit WHERE account_id = ? ORDER BY rowid DESC", accountId);
    const queued = await tx.getAllAsync<{ state: string; change_json: string }>("SELECT state, change_json FROM sync_queue WHERE account_id = ? ORDER BY id", accountId);
    const entryRecords = entries.map((row) => withoutLegacyDue(JSON.parse(row.record_json)) as Entry);
    const auditRecords = audit.map((row) => withoutLegacyDueFromAudit(JSON.parse(row.record_json)));
    const preferences = JSON.parse(account.preferences_json);
    return {
      accountId,
      data: {
        ...preferences,
        ...(accountData ? { signedIn: accountData.signedIn, shopExists: accountData.shopExists } : {}),
        shop: accountData?.shop || JSON.parse(account.shop_json),
        customers: customers.map((row) => normalizeCustomerLifecycle(JSON.parse(row.record_json))),
        entries: entryRecords,
        audit: auditRecords,
        deletedEntries: preferences.deletedEntries || deletedEntriesFromHistory(auditRecords, entryRecords),
      } as Data,
      queue: queued.map((row) => ({ state: row.state, change: parseQueuedChange(row.change_json) })),
      queueAvailable: true,
    };
  });
  const currentSession = await readOfflineSession().catch((error) => {
    if (options.authenticatedData && options.allowMissingOfflineSession) return null;
    throw error;
  });
  if (session && (!currentSession || currentSession.accountId !== session.accountId))
    throw new Error("The account session changed. Reopen the transaction.");
  if (currentSession && accountData) {
    authorizeReceiptAccess(accountData, accountId, currentSession, false);
  } else if (!currentSession && !options.allowMissingOfflineSession)
    throw new Error("Your offline authorization has expired. Sign in again when connected before exporting a receipt.");
  return snapshot;
}

/** Persist a device-local language choice without creating a shop-settings
 * synchronization operation or replacing cached financial records. */
export async function saveLocalLanguagePreference(accountId: string, language: string) {
  const db = await openDatabase();
  if (!db) return false;
  let saved = false;
  await withEncryptedTransaction(db, async (transaction) => {
    const row = await transaction.getFirstAsync<{ preferences_json: string }>(
      "SELECT preferences_json FROM local_accounts WHERE account_id = ?",
      accountId,
    );
    if (!row) return;
    const preferences = JSON.parse(row.preferences_json);
    await transaction.runAsync(
      "UPDATE local_accounts SET preferences_json = ?, updated_at = ? WHERE account_id = ?",
      JSON.stringify({ ...preferences, language }), Date.now(), accountId,
    );
    saved = true;
  });
  return saved;
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

/** Remove only cached subscription authorization metadata; customer, ledger and sync data stay intact. */
export async function clearOfflineSubscriptionState(accountId: string) {
  const db = await openDatabase();
  if (db)
    await db.runAsync(
      "DELETE FROM local_subscription_cache WHERE account_id = ?",
      accountId,
    );
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
      const failed = parseQueuedChange(row.change_json);
      blockedSettings ||= !!failed.settings;
      for (const item of failed.customers) {
        const customer = item.after || item.before;
        if (customer) {
          blockedCustomerMutations.add(customer.id);
          if (item.operation === "create" || item.operation === "delete" || item.operation === "lifecycle")
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
    const change = parseQueuedChange(item.change_json);
    if (item.next_attempt_at > Date.now()) {
      blockedSettings ||= !!change.settings;
      for (const customerChange of change.customers) {
        const customer = customerChange.after || customerChange.before;
        if (customer) {
          blockedCustomerMutations.add(customer.id);
          if (customerChange.operation === "create" || customerChange.operation === "lifecycle") blockedCustomerLedger.add(customer.id);
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
          const laterChange = parseQueuedChange(later.change_json);
          return laterChange.entries.some((entry) => (entry.after || entry.before)?.customerId === deletedCustomer);
        } catch { return true; }
      });
      if (hasLedgerDependency) continue;
    }
    return { id: item.id, change: normalizeSyncDelta(change) };
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
  const operation = change.entries.find((item) => item.operation === "create" || item.operation === "update" || item.operation === "delete");
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
  const operation = change.customers.find((item) => item.operation === "create" || item.operation === "update" || item.operation === "delete" || item.operation === "lifecycle");
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
    lifecycleChange: operation.operation === "lifecycle",
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
  return rows.flatMap((row) => { try { const value = JSON.parse(row.conflict_json) as unknown as { kind?: string }; return value.kind === "customer" || value.kind === "settings" ? [] : [normalizeLegacyConflict(value as PendingConflict)]; } catch { return []; } });
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
  await withEncryptedTransaction(db, async (transaction) => {
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
      const change = parseQueuedChange(row.change_json);
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
        defaultMethod: authoritative.defaultMethod,
        reminders: authoritative.reminders,
      };
      await transaction.runAsync(
        "UPDATE local_accounts SET shop_json = ?, preferences_json = ?, updated_at = ? WHERE account_id = ?",
        JSON.stringify(shop), JSON.stringify(preferences), Date.now(), accountId,
      );
    }
    await transaction.runAsync("INSERT OR IGNORE INTO local_audit (account_id, audit_id, record_json) VALUES (?, ?, ?)", accountId, audit.id, JSON.stringify(audit));
    const remaining = parseQueuedChange(conflicted.change_json);
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
  await withEncryptedTransaction(db, async (transaction) => {
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
      const change = parseQueuedChange(row.change_json);
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
    const original = parseQueuedChange(conflicted.change_json);
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
  const conflict = normalizeLegacyConflict(JSON.parse(row.conflict_json) as PendingConflict);
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
  const conflict = normalizeLegacyConflict(JSON.parse(row.conflict_json) as PendingConflict);
  conflict.chosen = choice;
  await db.runAsync("UPDATE sync_queue SET conflict_json = ? WHERE id = ?", JSON.stringify(conflict), id);
  return conflict;
}

export async function completeConflict(accountId: string, conflict: PendingConflict, authoritative: PendingConflict["server"], serverVersion: number, serverResolutionVersion: number, audit: Audit, authoritativeDeleted?: NonNullable<Data["deletedEntries"]>[number]) {
  const db = await openDatabase();
  if (!db) throw new Error("Encrypted offline storage is unavailable");
  await withEncryptedTransaction(db, async (transaction) => {
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
      const change = parseQueuedChange(row.change_json);
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
    const account = await transaction.getFirstAsync<{ preferences_json: string }>(
      "SELECT preferences_json FROM local_accounts WHERE account_id = ?", accountId,
    );
    if (account) {
      const preferences = JSON.parse(account.preferences_json) as ReturnType<typeof preferencesOf>;
      let deletedEntries = (preferences.deletedEntries || []).filter((item) => item.id !== conflict.entryId);
      if (!dependent && !authoritative && authoritativeDeleted)
        deletedEntries = [authoritativeDeleted, ...deletedEntries];
      await transaction.runAsync(
        "UPDATE local_accounts SET preferences_json = ?, updated_at = ? WHERE account_id = ?",
        JSON.stringify({ ...preferences, deletedEntries }), Date.now(), accountId,
      );
    }
    const remaining = parseQueuedChange(conflictedRow.change_json);
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
  acknowledged?: { customers?: Customer[]; entries?: Array<Entry & { deletedAt?: string }>; settings?: SyncSettings },
) {
  const db = await openDatabase();
  if (!db) return;
  await withEncryptedTransaction(db, async (transaction) => {
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
        const next = parseQueuedChange(nextRow.change_json);
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
        let hasLaterActive = false;
        for (const nextRow of nextRows) {
          const next = parseQueuedChange(nextRow.change_json);
          const list = kind === "customer" ? next.customers : next.entries;
          const item = list.find((candidate) => (candidate.after || candidate.before)?.id === entityId);
          if (!item) continue;
          hasLaterActive ||= Boolean(item.after && item.operation !== "delete");
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
        const account = await transaction.getFirstAsync<{ preferences_json: string }>(
          "SELECT preferences_json FROM local_accounts WHERE account_id = ?", row.account_id,
        );
        if (account) {
          const preferences = JSON.parse(account.preferences_json) as ReturnType<typeof preferencesOf>;
          const deletedEntries = (preferences.deletedEntries || []).filter((item) => item.id !== entityId);
          const deletedAt = (authoritative as Entry & { deletedAt?: string }).deletedAt;
          if (deletedAt && !hasLaterActive) deletedEntries.unshift({ ...(authoritative as Entry), deletedAt });
          await transaction.runAsync(
            "UPDATE local_accounts SET preferences_json = ?, updated_at = ? WHERE account_id = ?",
            JSON.stringify({ ...preferences, deletedEntries }), Date.now(), row.account_id,
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
    const errorCode = (error as { payload?: { code?: string } })?.payload?.code;
    const message =
      error instanceof Error && error.name === "ApiError"
        ? `${errorCode === "CUSTOMER_MOBILE_ALREADY_EXISTS" ? `${errorCode}: ` : ""}${error.message}`.slice(0, 300)
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
  const rows = await db.getAllAsync<{ state: string; count: number; mobile_conflicts: number }>(
    "SELECT state, COUNT(*) AS count, SUM(CASE WHEN last_error LIKE 'CUSTOMER_MOBILE_ALREADY_EXISTS:%' THEN 1 ELSE 0 END) AS mobile_conflicts FROM sync_queue WHERE account_id = ? GROUP BY state",
    accountId,
  );
  const counts = new Map(rows.map((row) => [row.state, row.count]));
  return {
    pending: counts.get("pending") || 0,
    failed: counts.get("failed") || 0,
    conflicts: counts.get("conflict") || 0,
    mobileConflicts: rows.reduce((sum, row) => sum + (row.mobile_conflicts || 0), 0),
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
    await withEncryptedTransaction(db, async (transaction) => {
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
