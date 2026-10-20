import * as api from "./api";
import { checkConnectivity } from "./connectivity";
import {
  acknowledgeChange,
  adoptServerDataIfQueueEmpty,
  hasPendingChanges,
  hasFailedChanges,
  hasUnresolvedConflicts,
  markConflict,
  markCustomerConflict,
  markSettingsConflict,
  markSyncFailurePermanent,
  nextPendingRetryAt,
  noteSyncFailure,
  offlineStorageAvailable,
  readNextChange,
  readOfflineSession,
} from "./offlineStore";
import type { Data } from "./model";

type ActiveSync = { promise: Promise<Data | null>; rerun: boolean; pullRemote: boolean };
const active = new Map<string, ActiveSync>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function runOnce(accountId: string, pullRemote: boolean) {
  const offlineSession = await readOfflineSession();
  if (!offlineSession || offlineSession.accountId !== accountId) return null;
  // Do not gate mutation replay on the unauthenticated health probe. The API
  // request itself is the authoritative reachability check; any HTTP response
  // updates shared connectivity evidence, while transport failures leave the
  // durable queue untouched for retry.
  if ((await checkConnectivity()) === "offline") return null;
  while (true) {
    let pending = await readNextChange(accountId);
    while (pending) {
      try {
        const acknowledged = await api.syncQueuedChange(pending.change);
        await acknowledgeChange(pending.id, acknowledged);
      } catch (error) {
        if (
          error instanceof api.ApiError &&
          error.status === 409 &&
          error.payload?.type === "shop_settings_conflict" &&
          pending.change.settings
        ) {
          await markSettingsConflict(pending.id, pending.change, error.payload.current || {});
          pending = await readNextChange(accountId);
          continue;
        }
        if (
          error instanceof api.ApiError &&
          error.status === 409 &&
          error.payload?.type === "customer_conflict" &&
          pending.change.customers.some((item) => item.operation === "create" || item.operation === "update" || item.operation === "delete")
        ) {
          await markCustomerConflict(pending.id, pending.change, error.payload?.current ?? null, error.payload?.serverVersion, error.payload?.resolutionVersion);
          pending = await readNextChange(accountId);
          continue;
        }
        if (
          error instanceof api.ApiError &&
          error.status === 409 &&
          error.payload?.code === "CUSTOMER_MOBILE_ALREADY_EXISTS" &&
          pending.change.customers.some((item) => item.operation === "create" || item.operation === "update")
        ) {
          // Keep the local customer/ledger intact, stop automatic retries, and
          // surface a dedicated resolution-required state in sync settings.
          await noteSyncFailure(pending.id, error);
          await markSyncFailurePermanent(pending.id);
          pending = await readNextChange(accountId);
          continue;
        }
        if (
          error instanceof api.ApiError &&
          error.status === 409 &&
          error.payload?.type === "transaction_conflict" &&
          pending.change.entries.some((item) => item.operation === "update" || item.operation === "delete")
        ) {
          await markConflict(pending.id, pending.change, error.payload?.current ?? null, error.payload?.serverVersion, error.payload?.resolutionVersion);
          pending = await readNextChange(accountId);
          continue;
        }
        if (
          error instanceof api.ApiError &&
          error.payload?.code === "CUSTOMER_LIMIT_REACHED"
        ) {
          // Keep the local customer and its failed queue record for review, but
          // don't let a subscription capacity decision block unrelated ledger
          // mutations later in the durable queue.
          await noteSyncFailure(pending.id, error);
          await markSyncFailurePermanent(pending.id);
          pending = await readNextChange(accountId);
          continue;
        }
        const permanent =
          error instanceof api.ApiError &&
          [400, 403, 404, 409, 413, 415, 422].includes(error.status);
        await noteSyncFailure(pending.id, error);
        if (permanent) await markSyncFailurePermanent(pending.id);
        if (error instanceof api.ApiError && error.status === 401)
          await api.clearOfflineAuthorization();
        throw error;
      }
      pending = await readNextChange(accountId);
    }
    if (!pullRemote) return null;
    if (await hasPendingChanges(accountId)) return null;
    if (
      (await hasUnresolvedConflicts(accountId)) ||
      (await hasFailedChanges(accountId))
    )
      return null;
    const remote = api.normalizeData(await api.loadAccount());
    if (await adoptServerDataIfQueueEmpty(accountId, remote)) return remote;
    if (!offlineStorageAvailable()) return remote;
  }
}

export function synchronizeAccount(
  accountId: string,
  pullRemote = true,
): Promise<Data | null> {
  const current = active.get(accountId);
  if (current) {
    current.rerun = true;
    current.pullRemote ||= pullRemote;
    return current.promise;
  }
  const state: ActiveSync = {
    promise: Promise.resolve(null),
    rerun: false,
    pullRemote,
  };
  state.promise = (async () => {
    let result: Data | null = null;
    while (true) {
      state.rerun = false;
      try {
        result = await runOnce(accountId, state.pullRemote);
      } catch (error) {
        if (state.rerun) continue;
        throw error;
      }
      if (!state.rerun) return result;
    }
  })();
  active.set(accountId, state);
  return state.promise.finally(() => {
    if (active.get(accountId) === state) active.delete(accountId);
    void nextPendingRetryAt(accountId).then((retryAt) => {
      if (retryTimers.has(accountId)) {
        clearTimeout(retryTimers.get(accountId)!);
        retryTimers.delete(accountId);
      }
      if (retryAt === null) return;
      const delay = Math.max(1000, retryAt - Date.now());
      retryTimers.set(accountId, setTimeout(() => {
        retryTimers.delete(accountId);
        void synchronizeAccount(accountId).catch(() => {});
      }, delay));
    }).catch(() => {});
  });
}

export async function synchronizePendingOnly(accountId: string) {
  if (!(await hasPendingChanges(accountId))) return null;
  return synchronizeAccount(accountId);
}
