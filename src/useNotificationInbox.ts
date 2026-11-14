import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as api from "./api";
import { observeConnectivity, currentConnectivity } from "./connectivity";
import {
  offlineStorageAvailable,
  readNotificationCache,
  cacheNotificationUnread,
  cacheNotifications,
  markLocalNotificationRead,
  readNotificationCommands,
  acknowledgeNotificationReads,
  cacheNotificationIds,
  readOfflineSession,
} from "./offlineStore";
import { loadNotifications, isExpoGo } from "./notificationRuntime";
import { InboxNotice } from "./notificationTypes";
export function useNotificationInbox(
  accountId: string | null,
  enabled: boolean,
) {
  const [online, setOnline] = useState(currentConnectivity() === "online");
  const [items, setItems] = useState<InboxNotice[]>([]),
    [unread, setUnread] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [hasMore, setMore] = useState(false),
    [accessBlocked, setAccessBlocked] = useState(false);
  const readRevision = useRef(0);
  const readThisSession = useRef(new Set<string>());
  const reconciliationAfter = useRef("");
  const remindersPreparedAt = useRef(0);
  const refreshQueued = useRef(false);
  const latestRefresh = useRef<() => void>(() => {});
  const displayedAccount = useRef<string | null>(null);
  const scope = useRef(accountId),
    generation = useRef(0),
    lock = useRef<number | null>(null),
    page = useRef(1),
    limit = useRef(2),
    offset = useRef(0);
  scope.current = accountId;
  const refresh = useCallback(
    async (more = false) => {
      if (!enabled || !accountId) return;
      if (lock.current === generation.current) {
        if (!more) refreshQueued.current = true;
        return;
      }
      lock.current = generation.current;
      if (!more) {
        offset.current = 0;
        limit.current = 2;
      }
      const epoch = generation.current;
      const initialReadRevision = readRevision.current;
      const current = () =>
        epoch === generation.current && scope.current === accountId;
      let useCache = false;
      let serverCountApplied = false;
      setBusy(true);
      setError("");
      try {
        const nativeCache = offlineStorageAvailable();
        const session = nativeCache ? await readOfflineSession() : null;
        if (!current()) return;
        useCache = nativeCache && session?.accountId === accountId;
        if (useCache) {
          const local = await readNotificationCache(
            accountId,
            limit.current,
            offset.current,
          );
          if (!current()) return;
          if (displayedAccount.current !== accountId) {
            displayedAccount.current = accountId;
            setItems(local.items);
            setUnread(local.unread);
          }
          // Drain bounded batches. Remaining durable commands retry on the next refresh.
          for (let batch = 0; batch < 10 && current(); batch++) {
            const commands = await readNotificationCommands(accountId);
            if (!current() || !commands.length) break;
            const ids = commands.map((r) => r.notification_id);
            await api.markNotificationsRead(ids);
            if (!current()) return;
            await acknowledgeNotificationReads(accountId, ids);
          }
        } else if (nativeCache) {
          // Expired offline sessions must not expose previously displayed private cache.
          setItems([]);
          setUnread(0);
          setAccessBlocked(true);
        }
        if (Date.now() - remindersPreparedAt.current > 15 * 60000) {
          try {
            await api.prepareSubscriptionInbox();
            if (current()) remindersPreparedAt.current = Date.now();
          } catch {
            if (current())
              setError(
                "Subscription reminder registration will retry. Other inbox notifications remain available.",
              );
          }
          if (!current()) return;
        }
        const next = more ? page.current + 1 : 1;
        const revision = readRevision.current;
        const result = await api.getNotifications(next);
        if (!current()) return;
        if (
          !Array.isArray(result.items) ||
          !Number.isSafeInteger(result.unread) ||
          result.unread < 0
        )
          throw Error("Notification response unavailable");
        setAccessBlocked(false);
        page.current = next;
        if (current()) {
          // A queued command may already be read on another device or hidden.
          // Only subtract recipients that are still server-visible and unread.
          const pending = useCache
            ? await readNotificationCommands(accountId)
            : [];
          if (!current()) return;
          let pendingUnread = 0;
          for (let start = 0; start < pending.length && current(); start += 2) {
            const state = await api.reconcileNotifications(
              pending.slice(start, start + 2).map((r) => r.notification_id),
            );
            if (!current()) return;
            pendingUnread += state.items.filter((n) => !n.read).length;
            await cacheNotifications(accountId, state.items, state.hiddenIds).catch(() => {
              if (current()) setError("Notification cache could not update. Offline content may be out of date.");
            });
          }
          if (current()) {
            if (revision !== readRevision.current) refreshQueued.current = true;
            else {
              const total = Math.max(0, result.unread - pendingUnread);
              displayedAccount.current = accountId;
              serverCountApplied = true;
              setUnread(total);
              if (useCache) await cacheNotificationUnread(accountId, total);
            }
          }
        }
        if (useCache) {
          await cacheNotifications(accountId, result.items);
          if (!current()) return;
          // Keyset iteration avoids skipping records hidden during reconciliation.
          if (!more) {
            for (let batch = 0; batch < 4 && current(); batch++) {
              const known = await cacheNotificationIds(
                accountId,
                reconciliationAfter.current,
              );
              if (!known.length) {
                reconciliationAfter.current = "";
                break;
              }
              const ids = known.map((r) => r.notification_id);
              const r = await api.reconcileNotifications(ids);
              if (!current()) return;
              await cacheNotifications(accountId, r.items, r.hiddenIds);
              reconciliationAfter.current = ids[ids.length - 1];
              if (known.length < 2) {
                reconciliationAfter.current = "";
                break;
              }
            }
          }
          if (current()) {
            const cached = await readNotificationCache(
              accountId,
              limit.current,
              offset.current,
            );
            if (current()) {
              displayedAccount.current = accountId;
              setItems((old) =>
                more
                  ? [
                      ...new Map(
                        [...old, ...result.items].map((n) => [n.id, n]),
                      ).values(),
                    ].slice(-10)
                  : result.items,
              );
              setMore(result.hasMore);
            }
          }
        } else {
          displayedAccount.current = accountId;
          setItems((old) =>
            more
              ? [
                  ...new Map(
                    [...old, ...result.items].map((n) => [n.id, n]),
                  ).values(),
                ].slice(-10)
              : result.items,
          );
          setMore(result.hasMore);
        }

      } catch (e) {
        if (current()) {
          if (!serverCountApplied && !useCache && offlineStorageAvailable()) {
            setItems([]);
            setUnread(0);
            setAccessBlocked(true);
          }
          setError(
            e instanceof Error && e.message.includes("100 MiB")
              ? e.message
              : "Notifications could not synchronize. Cached messages remain available; saved read changes will retry.",
          );
          const local = useCache
            ? await readNotificationCache(
                accountId,
                limit.current,
                offset.current,
              ).catch(() => null)
            : null;
          if (local && current()) {
            displayedAccount.current = accountId;
            setItems(local.items);
            if (!serverCountApplied && initialReadRevision === readRevision.current) setUnread(local.unread);
            setMore(local.total > offset.current + local.items.length);
          }
        }
      } finally {
        if (current()) setBusy(false);
        if (lock.current === epoch) lock.current = null;
        if (current() && refreshQueued.current) {
          refreshQueued.current = false;
          setTimeout(() => latestRefresh.current(), 0);
        }
      }
    },
    [accountId, enabled],
  );
  latestRefresh.current = () => {
    void refresh();
  };
  useEffect(() => {
    refreshQueued.current = false;
    generation.current++;
    page.current = 1;
    reconciliationAfter.current = "";
    remindersPreparedAt.current = 0;
    limit.current = 2;
    offset.current = 0;
    lock.current = null;
    readThisSession.current.clear();
    displayedAccount.current = null;
    setItems([]);
    setUnread(0);
    setMore(false);
    setError("");
    if (!enabled || !accountId) return;
    void refresh();
    const stop = observeConnectivity((status) => {
      setOnline(status === "online");
      if (status === "online") void refresh();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 60000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => {
      generation.current++;
      stop();
      clearInterval(timer);
      sub.remove();
    };
  }, [accountId, enabled, refresh]);
  useEffect(() => {
    if (!enabled || isExpoGo) return;
    let active = true;
    let listener: { remove: () => void } | undefined;
    void loadNotifications()
      .then((n) => {
        if (active)
          listener = n.addNotificationReceivedListener(() => {
            void refresh();
          });
      })
      .catch(() => {});
    return () => {
      active = false;
      listener?.remove();
    };
  }, [enabled, refresh]);
  const read = async (notice: InboxNotice) => {
    if (
      !accountId ||
      !enabled ||
      notice.read ||
      readThisSession.current.has(notice.id)
    )
      return;
    readThisSession.current.add(notice.id);
    readRevision.current++;
    const key = accountId;
    setItems((old) =>
      old.map((n) => (n.id === notice.id ? { ...n, read: true } : n)),
    );
    setUnread((n) => Math.max(0, n - 1));
    try {
      const session = offlineStorageAvailable()
        ? await readOfflineSession()
        : null;
      if (scope.current !== key) return;
      if (session?.accountId === key) {
        await cacheNotifications(key, [notice]);
        await markLocalNotificationRead(key, notice.id);
      } else await api.markNotificationsRead([notice.id]);
      if (scope.current !== key) return;
      setItems((old) =>
        old.map((n) => (n.id === notice.id ? { ...n, read: true } : n)),
      );

      void refresh();
    } catch {
      readThisSession.current.delete(notice.id);
      readRevision.current++;
      if (scope.current === key) {
        setItems((old) =>
          old.map((n) => (n.id === notice.id ? { ...n, read: false } : n)),
        );
        setUnread((n) => n + 1);
        setError("Unable to save read status. Please retry.");
      }
    }
  };
  const loadMore = () => {
    if (busy) return;
    if (limit.current >= 10) offset.current += 2;
    else limit.current += 2;
    void refresh(true);
  };
  return {
    items:
      enabled && displayedAccount.current === accountId
        ? items.map((n) =>
            readThisSession.current.has(n.id) ? { ...n, read: true } : n,
          )
        : [],
    unread: enabled && displayedAccount.current === accountId ? unread : 0,
    error,
    online,
    accessBlocked,
    busy,
    hasMore,
    refresh: () => refresh(),
    loadMore,
    read,
  };
}
