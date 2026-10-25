import type { SyncQueueStatus } from "./offlineStore";

export type SyncStatusState =
  | { kind: "unavailable"; reason: "not_signed_in" | "shop_context" | "storage" | "read" }
  | { kind: "available"; status: "synced" | "pending" | "syncing" | "failed" | "conflict" | "offline"; counts: SyncQueueStatus };

export function syncStatusFromQueue(
  counts: SyncQueueStatus,
  { offline, syncing }: { offline: boolean; syncing: boolean },
): SyncStatusState {
  if (offline) return { kind: "available", status: "offline", counts };
  if (counts.conflicts || counts.mobileConflicts)
    return { kind: "available", status: "conflict", counts };
  if (counts.failed) return { kind: "available", status: "failed", counts };
  if (syncing) return { kind: "available", status: "syncing", counts };
  if (counts.pending) return { kind: "available", status: "pending", counts };
  return { kind: "available", status: "synced", counts };
}

export function syncStatusUnavailable(reason: Extract<SyncStatusState, { kind: "unavailable" }>["reason"]): SyncStatusState {
  return { kind: "unavailable", reason };
}
