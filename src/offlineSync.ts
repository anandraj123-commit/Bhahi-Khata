import NetInfo from "@react-native-community/netinfo";
import * as api from "./api";
import {
  acknowledgeChange,
  adoptServerDataIfQueueEmpty,
  hasPendingChanges,
  hasFailedChanges,
  hasUnresolvedConflicts,
  markConflict,
  markSyncFailurePermanent,
  noteSyncFailure,
  offlineStorageAvailable,
  readNextChange,
} from "./offlineStore";
import type { Data } from "./model";

type ActiveSync = { promise: Promise<Data | null>; rerun: boolean; pullRemote: boolean };
const active = new Map<string, ActiveSync>();

async function runOnce(accountId: string, pullRemote: boolean) {
  const network = await NetInfo.fetch();
  if (network.isConnected === false || network.isInternetReachable === false)
    return null;
  while (true) {
    let pending = await readNextChange(accountId);
    while (pending) {
      try {
        await api.syncQueuedChange(pending.change);
        await acknowledgeChange(pending.id);
      } catch (error) {
        if (
          error instanceof api.ApiError &&
          error.status === 409 &&
          error.payload?.type === "transaction_conflict" &&
          pending.change.entries.some((item) => item.operation === "update" || item.operation === "delete")
        ) {
          await markConflict(pending.id, pending.change, error.payload?.current ?? null, error.payload?.serverVersion);
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
  });
}

export async function synchronizePendingOnly(accountId: string) {
  if (!(await hasPendingChanges(accountId))) return null;
  return synchronizeAccount(accountId);
}
