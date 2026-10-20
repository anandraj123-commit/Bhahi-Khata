import { LanguageContext, Text } from "./src/i18n";
import ErrorBoundary from "./src/ErrorBoundary";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { isExpoGo, loadNotifications } from "./src/notificationRuntime";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import {
  balance,
  Customer,
  Data,
  Entry,
  financialSummary,
  initialData,
  money,
  monthly,
  periodReceived,
  periodUdhari,
  today,
  totalUdhari,
  uid,
  validBackup,
} from "./src/model";
import { normalizeCustomerMobile } from "./src/customerPhone";
import * as api from "./src/api";
import {
  cacheAuthenticatedAccount,
  cacheSubscriptionSnapshot,
  clearOfflineAccount,
  clearOfflineSession,
  hasPendingChanges,
  completeConflict,
  completeCustomerConflict,
  completeSettingsConflict,
  chooseConflictResolution,
  chooseCustomerConflictResolution,
  chooseSettingsConflictResolution,
  offlineStorageAvailable,
  offlineStorageReadiness,
  offlineStorageDiagnostics,
  retryOfflineStorageInitialization,
  readCachedAccount,
  readSubscriptionSnapshot,
  readPendingConflicts,
  readPendingCustomerConflicts,
  readPendingSettingsConflicts,
  readOfflineSession,
  readSyncQueueStatus,
  retryFailedChanges,
  refreshConflict,
  refreshCustomerConflict,
  refreshSettingsConflict,
  saveLocalChange,
  type PendingConflict,
  type PendingCustomerConflict,
  type PendingSettingsConflict,
} from "./src/offlineStore";
import { synchronizeAccount, synchronizePendingOnly } from "./src/offlineSync";
import {
  checkConnectivity,
  connectivityBuildInfo,
  currentConnectivity,
  currentConnectivityDetails,
  observeConnectivity,
  type ConnectivityStatus,
} from "./src/connectivity";
import type { SubscriptionSnapshot } from "./src/subscription";
import {
  Button,
  Card,
  Chips,
  colors,
  Empty,
  Field,
  Hint,
  Icon,
  Row,
  s,
  Title,
  Toggle,
} from "./src/ui";

type Screen =
  | "welcome"
  | "login"
  | "otp"
  | "setup"
  | "home"
  | "customers"
  | "customerForm"
  | "customer"
  | "credit"
  | "payment"
  | "refund"
  | "transaction"
  | "editTransaction"
  | "khata"
  | "statement"
  | "share"
  | "notifications"
  | "reports"
  | "more"
  | "profile"
  | "settings"
  | "reminders"
  | "help"
  | "subscription"
  | "subscriptionPayments"
  | "account"
  | "audit";
type Route = { screen: Screen; id?: string };
const monthLabel = (month: string) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
const monthForDate = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const phoneValid = (value: string) => /^[6-9]\d{9}$/.test(value);
const accountKey = (value: string) => value.replace(/\D/g, "");
const isOfflineError = (error: unknown) =>
  (error instanceof api.ApiTransportError && error.kind === "network") ||
  error instanceof TypeError ||
  (error instanceof Error &&
    (error.name === "AbortError" ||
      /network request failed|failed to fetch|network error|internet connection/i.test(
        error.message,
      )));
const showOtpError = (title: string, error: unknown, fallback: string) => {
  const unreachable = isOfflineError(error);
  const offline = currentConnectivity() === "offline";
  Alert.alert(
    unreachable && offline ? "You’re offline" : unreachable ? "Server unavailable" : title,
    unreachable && offline
      ? "Connect to Wi-Fi or another network to sign in."
      : unreachable
        ? "A network is connected, but the Digital-Khata server could not be reached. Check the server address or try again."
        : errorMessage(error, fallback),
  );
};
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof api.ApiTransportError
    ? error.kind === "timeout"
      ? "The request timed out. Check your connection and try again."
      : currentConnectivity() === "offline"
        ? "No active network connection. Connect to Wi-Fi or another network and try again."
        : "Could not reach the Digital-Khata server on the current network. Try again when the server is available."
    : error instanceof api.ApiError
      ? error.message
      : fallback;
const titles: Partial<Record<Screen, string>> = {
  login: "Login",
  otp: "Verify Mobile",
  setup: "Set Up Your Shop",
  customers: "Customers",
  customerForm: "Add Customer",
  credit: "Add Udhari",
  payment: "Receive Money / Add Advance",
  refund: "Refund Advance",
  transaction: "Transaction",
  editTransaction: "Edit Transaction",
  khata: "Khata",
  statement: "Monthly Statement",
  share: "Share Statement",
  notifications: "Notifications",
  reports: "Reports",
  more: "More",
  profile: "Shop Profile",
  settings: "Settings",
  reminders: "Reminder Settings",
  help: "Help & Support",
  subscription: "My Subscription",
  subscriptionPayments: "Payment History",
  account: "Account",
  audit: "Activity History",
};
const entryLabel = (type: Entry["type"]) =>
  type === "credit" ? "Udhari Given" : type === "refund" ? "Advance Refund" : "Payment Received";
const entrySign = (type: Entry["type"]) => type === "payment" ? "−" : "+";

async function scheduleSubscriptionNotifications(
  snapshot: SubscriptionSnapshot,
  accountId: string,
  requestPermission: boolean,
) {
  const Notifications = await loadNotifications();
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("subscription", {
      name: "Subscription reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && requestPermission)
    permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return { granted: false, identifiers: [] as string[] };
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const request of existing) {
    if (request.content.data?.kind === "subscription-expiry" && request.content.data?.accountId === accountId)
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
  }
  const expiry = snapshot.current.expiresAt ? new Date(snapshot.current.expiresAt) : null;
  if (!expiry || !Number.isFinite(expiry.getTime())) return { granted: true, identifiers: [] as string[] };
  if (
    snapshot.current.scheduled &&
    new Date(snapshot.current.scheduled.startsAt).getTime() <= expiry.getTime() &&
    (!snapshot.current.scheduled.expiresAt ||
      new Date(snapshot.current.scheduled.expiresAt).getTime() > expiry.getTime())
  )
    return { granted: true, identifiers: [] as string[] };
  const created: string[] = [];
  for (const days of [15, 7, 3, 1, 0]) {
    const triggerDate = new Date(expiry);
    triggerDate.setDate(triggerDate.getDate() - days);
    triggerDate.setHours(9, 0, 0, 0);
    if (triggerDate.getTime() <= Date.now()) continue;
    const remaining = days === 0 ? "expires today" : `expires in ${days} ${days === 1 ? "day" : "days"}`;
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Digital-Khata subscription reminder",
        body: `Your ${snapshot.current.plan.name} plan ${remaining}. Review renewal options in My Subscription.`,
        data: { kind: "subscription-expiry", accountId, screen: "subscription" },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
        ...(Platform.OS === "android" ? { channelId: "subscription" } : {}),
      },
    });
    created.push(identifier);
  }
  return { granted: true, identifiers: created };
}

async function cancelSubscriptionNotifications(accountId: string) {
  try {
    const Notifications = await loadNotifications();
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    for (const request of existing)
      if (request.content.data?.kind === "subscription-expiry" && request.content.data?.accountId === accountId)
        await Notifications.cancelScheduledNotificationAsync(request.identifier);
  } catch { /* Notification scheduling may not be available in this runtime. */ }
}

function AppContent() {
  const [data, setData] = useState<Data>(initialData);
  const dataRef = useRef(data);
  const persistedRef = useRef<Data | null>(null);
  const offlineAccountRef = useRef<string | null>(null);
  const localRevision = useRef(0);
  const subscriptionAccountRef = useRef<string | null>(null);
  const promptingConflict = useRef<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const writeQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const [route, setRoute] = useState<Route>({ screen: "welcome" });
  const [history, setHistory] = useState<Route[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [form, setForm] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpHint, setOtpHint] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [notices, setNotices] = useState<{id:string;title:string;body:string;read:boolean;date:string}[]>([]);
  const [seconds, setSeconds] = useState(30);
  const [busy, setBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    pending: number;
    failed: number;
    conflicts: number;
    mobileConflicts: number;
  } | null>(null);
  const [connectivityStatus, setConnectivityStatus] = useState<ConnectivityStatus>("checking");
  const [networkDiagnosticsVisible, setNetworkDiagnosticsVisible] = useState(false);
  const [networkDiagnosticsRetrying, setNetworkDiagnosticsRetrying] = useState(false);
  const [storageRetrying, setStorageRetrying] = useState(false);
  const [, setNetworkDiagnosticsRevision] = useState(0);
  const networkDiagnostics = currentConnectivityDetails();
  const networkBuildInfo = connectivityBuildInfo();
  const storageDiagnostics = offlineStorageDiagnostics();
  const retryNetworkDiagnostics = async () => {
    setNetworkDiagnosticsRetrying(true);
    try {
      await checkConnectivity(true);
    } finally {
      setNetworkDiagnosticsRevision((revision) => revision + 1);
      setNetworkDiagnosticsRetrying(false);
    }
  };
  const retryStorageInitialization = async () => {
    setStorageRetrying(true);
    try { await retryOfflineStorageInitialization(); }
    catch { /* The safe, sanitized result is shown in diagnostics. */ }
    finally {
      setNetworkDiagnosticsRevision((revision) => revision + 1);
      setStorageRetrying(false);
    }
  };
  const lock = useRef(false);
  const syncNotice = useRef<string | null>(null);
  const [faq, setFaq] = useState("");
  const [channel, setChannel] = useState("WhatsApp");
  const [plan, setPlan] = useState("Pro");
  const [subscriptionSnapshot, setSubscriptionSnapshot] = useState<SubscriptionSnapshot | null>(null);
  const subscriptionSnapshotRef = useRef<SubscriptionSnapshot | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionPageLoading, setSubscriptionPageLoading] = useState(false);
  const [subscriptionLoadError, setSubscriptionLoadError] = useState("");
  const [subscriptionDuration, setSubscriptionDuration] = useState("1");
  async function refreshSyncStatus(accountId = offlineAccountRef.current) {
    if (!accountId || !offlineStorageAvailable()) {
      setSyncStatus(null);
      return;
    }
    try {
      setSyncStatus(await readSyncQueueStatus(accountId));
    } catch {
      setSyncStatus(null);
    }
  }
  async function refreshSubscriptionInfo(
    accountId = offlineAccountRef.current,
    promptPermission = false,
  ) {
    if (!accountId) return;
    if (route.screen === "subscription" || route.screen === "subscriptionPayments")
      setSubscriptionLoading(true);
    try {
      if ((await checkConnectivity()) !== "online")
        throw new api.ApiTransportError("network");
      const snapshot = await api.getSubscriptionSnapshot();
      snapshot.cachedAt = Date.now();
      setSubscriptionSnapshot(snapshot);
      setSubscriptionLoadError("");
      if (offlineStorageAvailable())
        await cacheSubscriptionSnapshot(accountId, snapshot).catch(() => false);
      try {
        const reminders = await scheduleSubscriptionNotifications(
          snapshot,
          accountId,
          promptPermission,
        );
        snapshot.notificationsGranted = reminders.granted;
        snapshot.localNotificationIds = reminders.identifiers;
        if (offlineStorageAvailable())
          await cacheSubscriptionSnapshot(accountId, snapshot).catch(() => false);
      } catch {
        snapshot.notificationsGranted = false;
      }
    } catch (problem) {
      let cached: unknown = null;
      try { cached = await readSubscriptionSnapshot(accountId); } catch { cached = null; }
      if (cached && typeof cached === "object" && "current" in cached && "plans" in cached) {
        const snapshot = cached as SubscriptionSnapshot;
        setSubscriptionSnapshot(snapshot);
        setSubscriptionLoadError("");
        try {
          const reminders = await scheduleSubscriptionNotifications(snapshot, accountId, false);
          snapshot.notificationsGranted = reminders.granted;
          snapshot.localNotificationIds = reminders.identifiers;
        } catch { snapshot.notificationsGranted = false; }
      } else {
        setSubscriptionLoadError(errorMessage(problem, "Subscription information is unavailable."));
      }
    } finally {
      if (route.screen === "subscription" || route.screen === "subscriptionPayments")
        setSubscriptionLoading(false);
    }
  }
  async function loadMoreSubscriptionPayments() {
    const accountId = offlineAccountRef.current;
    const cursor = subscriptionSnapshot?.paymentsNextCursor;
    if (!accountId || !cursor || subscriptionPageLoading) return;
    setSubscriptionPageLoading(true);
    try {
      const page = await api.getSubscriptionPayments(cursor);
      const next = {
        ...subscriptionSnapshot!,
        payments: [
          ...subscriptionSnapshot!.payments,
          ...page.items.filter((item) => !subscriptionSnapshot!.payments.some((old) => old.id === item.id)),
        ],
        paymentsNextCursor: page.nextCursor,
      };
      setSubscriptionSnapshot(next);
      if (offlineStorageAvailable()) await cacheSubscriptionSnapshot(accountId, next);
    } catch (problem) {
      Alert.alert("Unable to load payment history", errorMessage(problem, "Please try again when you are online."));
    } finally { setSubscriptionPageLoading(false); }
  }
  async function showSyncFailure(problem: unknown) {
    const key =
      problem instanceof api.ApiError &&
      [400, 403, 404, 409, 413, 415, 422].includes(problem.status)
        ? "permanent"
        : problem instanceof api.ApiTransportError
          ? problem.kind
          : problem instanceof api.ApiError &&
              (problem.status === 429 || problem.status >= 500)
            ? "server"
            : "other";
    const networkStatus = key === "network" ? await checkConnectivity(true) : null;
    const noticeKey = key === "network"
      ? networkStatus === "offline" ? "network-offline" : "network-server"
      : key;
    if (syncNotice.current === noticeKey) return;
    syncNotice.current = noticeKey;
    if (key === "permanent")
      Alert.alert(
        "Some changes need attention",
        "Your changes remain saved on this phone and will not retry automatically. Open Settings to review the sync status and retry when appropriate.",
      );
    else if (key === "network" && networkStatus === "offline")
      Alert.alert(
        "You’re offline",
        "Your saved changes remain on this phone and will sync when Wi-Fi or another network is available.",
      );
    else if (key === "network")
      Alert.alert(
        "Server unavailable",
        "A network is connected, but Digital-Khata could not be reached. Your saved changes remain on this phone and will sync when the server is available.",
      );
    else if (key === "timeout")
      Alert.alert(
        "Sync timed out",
        "Your saved changes remain on this phone. Synchronization will retry later.",
      );
    else if (key === "server")
      Alert.alert(
        "Sync temporarily unavailable",
        "Your saved changes remain on this phone. Synchronization will retry later.",
      );
    else
      Alert.alert(
        "Could not sync changes",
        "Your saved changes remain on this phone. Check your account and connection before retrying.",
      );
  }
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const connectivity = await checkConnectivity();
        if (connectivity === "offline") {
          const offlineSession = await readOfflineSession();
          const cached = offlineSession
            ? await readCachedAccount(offlineSession.accountId)
            : null;
          if (live && offlineSession && cached && validBackup(cached)) {
            offlineAccountRef.current = offlineSession.accountId;
            setData(cached);
            dataRef.current = cached;
            persistedRef.current = cached;
            setRoute({ screen: (cached.shopComplete ?? Boolean(cached.shop.name.trim() && cached.shop.owner.trim())) ? "home" : "setup" });
          } else if (live) {
            setRoute({ screen: "login" });
            Alert.alert(
              "You’re offline",
              "Connect to Wi-Fi or another network to sign in.",
            );
          }
          return;
        }
        const remote = await api.restoreSession();
        if (live && remote) {
          let parsed = api.normalizeData(remote);
          if (!validBackup(parsed)) throw new Error("Invalid server data");
          const id = parsed.shopExists ? accountKey(parsed.shop.phone) : "";
          offlineAccountRef.current = id || null;
          if (id && offlineStorageAvailable()) {
            try {
              const synchronized = await synchronizePendingOnly(id);
              if (synchronized) parsed = synchronized;
              else if (await hasPendingChanges(id)) {
                const cached = await readCachedAccount(id);
                if (cached && validBackup(cached)) parsed = cached;
              }
            } catch (error) {
              if (error instanceof api.ApiError && error.status === 401) throw error;
              try {
                const cached = await readCachedAccount(id);
                if (cached && validBackup(cached)) parsed = cached;
              } catch {
                offlineAccountRef.current = null;
                if (live)
                  Alert.alert(
                    "Offline data unavailable",
                    "Your account is available online, but cached data could not be read on this device.",
                  );
              }
            }
            if (offlineAccountRef.current === id) {
              try {
                await cacheAuthenticatedAccount(id, parsed);
              } catch {
                offlineAccountRef.current = null;
                if (live)
                  Alert.alert(
                    "Offline data could not be saved",
                    "Your account is available online. Keep an internet connection for changes until offline storage is available.",
                  );
              }
            }
          }
          setData(parsed);
          dataRef.current = parsed;
          persistedRef.current = parsed;
          setRoute({ screen: parsed.shopComplete ? "home" : "setup" });
        } else if (live) {
          // A successful health probe is not required to establish an
          // authenticated session. A real API request may work even if the
          // lightweight health endpoint failed. Conversely, a server-confirmed
          // invalid session must not fall back to cached offline authorization.
          offlineAccountRef.current = null;
          setRoute({ screen: "login" });
        }
      } catch (error) {
        const canUseCachedSession =
          isOfflineError(error) ||
          (error instanceof api.ApiError && error.status >= 500);
        if (live && canUseCachedSession) {
          let offlineSession: Awaited<ReturnType<typeof readOfflineSession>> = null;
          let cached: Data | null = null;
          try {
            offlineSession = await readOfflineSession();
            cached = offlineSession
              ? await readCachedAccount(offlineSession.accountId)
              : null;
          } catch {
            cached = null;
          }
          if (offlineSession && cached && validBackup(cached)) {
            offlineAccountRef.current = offlineSession.accountId;
            setData(cached);
            dataRef.current = cached;
            persistedRef.current = cached;
            setRoute({ screen: (cached.shopComplete ?? Boolean(cached.shop.name.trim() && cached.shop.owner.trim())) ? "home" : "setup" });
          } else {
            setRoute({ screen: "login" });
            if (isOfflineError(error) && currentConnectivity() === "offline")
              Alert.alert("You’re offline", "Connect to Wi-Fi or another network to sign in.");
            else if (isOfflineError(error))
              Alert.alert("Server unavailable", "A network is connected, but the Digital-Khata server could not be reached.");
            else
              Alert.alert(
                "Could not connect to your khata",
                "Please try again when the service is available.",
              );
          }
        } else if (live && error instanceof api.ApiError && error.status === 401) {
          offlineAccountRef.current = null;
          setRoute({ screen: "login" });
        } else if (live) {
          setLoadError(true);
          Alert.alert(
            "Could not connect to your khata",
            errorMessage(error, "Check your internet connection and try again."),
          );
        }
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!data.signedIn || data.shopExists === false) return;
    if (isExpoGo) return;
    let live = true;
    (async () => {
      try {
        const Notifications = await loadNotifications();
        if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { name: "Digital Khata", importance: Notifications.AndroidImportance.DEFAULT });
        if (!Device.isDevice || !process.env.EXPO_PUBLIC_EAS_PROJECT_ID) return;
        const current = await Notifications.getPermissionsAsync();
        const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
        if (!permission.granted) return;
        const token = await Notifications.getExpoPushTokenAsync({ projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID });
        if (live) await api.registerPushToken(token.data, Platform.OS === "ios" ? "ios" : "android");
      } catch {
        if (live)
          Alert.alert(
            "Push notifications unavailable",
            "You can continue using your khata. Notification registration can be retried later.",
          );
      }
    })();
    return () => { live = false; };
  }, [data.signedIn, data.shopExists]);
  useEffect(() => observeConnectivity(setConnectivityStatus), []);
  useEffect(() => {
    const id = offlineAccountRef.current;
    if (!data.signedIn || !id || !offlineStorageAvailable()) return;
    let live = true;
    let online = false;
    const runSync = () => {
      const revision = localRevision.current;
      void refreshSubscriptionInfo(id, false);
      void synchronizeAccount(id)
        .then((remote) => {
          syncNotice.current = null;
          void refreshSyncStatus(id);
          if (
            !live ||
            !remote ||
            offlineAccountRef.current !== id ||
            localRevision.current !== revision
          )
            return;
          dataRef.current = remote;
          persistedRef.current = remote;
          setData(remote);
        })
        .catch((error) => {
          void refreshSyncStatus(id);
          if (
            live &&
            error instanceof api.ApiError &&
            error.status === 401
          ) {
            offlineAccountRef.current = null;
            dataRef.current = initialData;
            setData(initialData);
            setRoute({ screen: "login" });
            setHistory([]);
          } else if (live) {
            showSyncFailure(error);
          }
        })
        .finally(() => { if (live) void promptNextConflict(id); });
    };
    const unsubscribe = observeConnectivity((state) => {
      if (state === "online" && !online) runSync();
      online = state === "online";
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [data.signedIn]);
  useEffect(() => {
    const id = offlineAccountRef.current;
    if (data.signedIn && id) void promptNextConflict(id);
  }, [data.signedIn]);
  useEffect(() => {
    void refreshSyncStatus();
  }, [data.signedIn, data.shop.phone, route.screen]);
  useEffect(() => {
    const id = offlineAccountRef.current;
    if (!data.signedIn || !id || !["subscription", "subscriptionPayments"].includes(route.screen)) return;
    void refreshSubscriptionInfo(id, route.screen === "subscription");
  }, [data.signedIn, data.shop.phone, route.screen]);
  useEffect(() => {
    if (data.signedIn) return;
    subscriptionAccountRef.current = null;
    setSubscriptionSnapshot(null);
    setSubscriptionLoadError("");
  }, [data.signedIn]);
  useEffect(() => {
    subscriptionSnapshotRef.current = subscriptionSnapshot;
  }, [subscriptionSnapshot]);
  useEffect(() => {
    const id = offlineAccountRef.current;
    if (!data.signedIn || !id) return;
    if (subscriptionAccountRef.current !== id) {
      subscriptionAccountRef.current = id;
      setSubscriptionSnapshot(null);
      void refreshSubscriptionInfo(id, false);
    }
  }, [data.signedIn, data.shop.phone]);
  useEffect(() => {
    if (!data.signedIn || data.shopExists === false) return;
    let live = true;
    let subscription: { remove: () => void } | undefined;
    (async () => {
      try {
        const Notifications = await loadNotifications();
        const openSubscription = (response: any) => {
          const target = response?.notification?.request?.content?.data;
          if (
            target?.screen === "subscription" &&
            (target?.accountId === offlineAccountRef.current ||
              target?.shopId === subscriptionSnapshotRef.current?.current?.shopId)
          )
            go("subscription");
        };
        subscription = Notifications.addNotificationResponseReceivedListener(openSubscription);
        const last = await Notifications.getLastNotificationResponseAsync();
        if (live && last) openSubscription(last);
      } catch { /* Notifications may be unavailable in the current runtime. */ }
    })();
    return () => {
      live = false;
      subscription?.remove();
    };
  }, [data.signedIn, data.shopExists]);
  useEffect(() => {
    if (route.screen !== "notifications" || !data.signedIn || data.shopExists === false) return;
    api
      .getNotifications()
      .then((result) => setNotices(result.items))
      .catch(() =>
        Alert.alert(
          "Unable to load notifications",
          "Check your connection and open Notifications again to retry.",
        ),
      );
  }, [route.screen, data.signedIn, data.shopExists]);
  useEffect(() => {
    if (route.screen !== "otp" || seconds <= 0) return;
    const t = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(t);
  }, [route.screen, seconds]);
  const back = () => {
    if (route.screen === "setup" && data.signedIn && data.shopExists === false) {
      setRoute({ screen: "login" });
      setHistory([{ screen: "welcome" }]);
      setSearch("");
      setFilter("All");
    } else if (history.length) {
      setRoute(history[history.length - 1]);
      setHistory(history.slice(0, -1));
      setSearch("");
      setFilter("All");
    } else if (data.signedIn && route.screen !== "home" && data.shopComplete) {
      setRoute({ screen: "home" });
    } else return false;
    return true;
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", back);
    return () => sub.remove();
  }, [history, route, data.signedIn]);
  function commit(next: Data): Promise<boolean> {
    if (loadError) return Promise.resolve(false);
    const previous = dataRef.current;
    dataRef.current = next;
    const operation = writeQueue.current.then(async () => {
      try {
        const persisted = persistedRef.current;
        if (persisted?.signedIn && !next.signedIn) {
          const accountId = offlineAccountRef.current;
          if ((await checkConnectivity(true)) === "online")
            await api.logout().catch(() => {});
          else await api.clearTokens();
          await clearOfflineSession();
          if (accountId) await cancelSubscriptionNotifications(accountId);
          offlineAccountRef.current = null;
          persistedRef.current = null;
        } else if (persisted?.signedIn) {
          const accountId = offlineAccountRef.current;
          if (accountId && offlineStorageAvailable()) {
            const operationId = await saveLocalChange(accountId, previous, next);
            if (operationId === null) {
              if ((await checkConnectivity(true)) !== "online")
                throw new Error("OFFLINE_ENCRYPTED_STORAGE_UNAVAILABLE");
              await api.syncChange(persisted, next);
              persistedRef.current = next;
              setData(next);
              return true;
            }
            localRevision.current += 1;
            void refreshSyncStatus(accountId);
            const revision = localRevision.current;
            persistedRef.current = next;
            setData(next);
            void synchronizeAccount(accountId, false)
              .then(async (remote) => {
                syncNotice.current = null;
                void refreshSyncStatus(accountId);
                let synchronized = remote;
                if (!synchronized) {
                  try { synchronized = await readCachedAccount(accountId); } catch { synchronized = null; }
                }
                if (
                  synchronized &&
                  offlineAccountRef.current === accountId &&
                  localRevision.current === revision
                ) {
                  dataRef.current = synchronized;
                  persistedRef.current = synchronized;
                  setData(synchronized);
                }
              })
              .catch((error) => {
                void refreshSyncStatus(accountId);
                showSyncFailure(error);
              });
            return true;
          }
          if ((await checkConnectivity()) === "offline") {
            if (!accountId)
              throw new Error("OFFLINE_AUTHORIZATION_UNAVAILABLE");
            throw new Error("OFFLINE_ENCRYPTED_STORAGE_UNAVAILABLE");
          }
          await api.syncChange(persisted, next);
          persistedRef.current = next;
        }
        setData(next);
        return true;
      } catch (error) {
        if (dataRef.current === next) {
          dataRef.current = previous;
          setData(previous);
        }
        if (error instanceof Error && error.message === "OFFLINE_ENCRYPTED_STORAGE_UNAVAILABLE")
          Alert.alert("Offline saving unavailable", "Offline changes require the installed Digital-Khata app with encrypted storage. Open the app in an installed development or release build; Expo Go cannot use this encrypted database.");
        else if (error instanceof Error && error.message === "OFFLINE_AUTHORIZATION_UNAVAILABLE")
          Alert.alert("Offline access unavailable", "No valid offline authorization is active for this shop. Reconnect and sign in before making offline changes.");
        else if (error instanceof Error && /Encrypted local storage requires the installed app build/.test(error.message))
          Alert.alert("Secure storage unavailable", "No changes were saved. Install the supported Digital-Khata build with encrypted local storage and try again.");
        else
          Alert.alert("Unable to save", errorMessage(error, "No changes were saved. Please try again."));
        return false;
      }
    });
    writeQueue.current = operation;
    return operation;
  }
  async function save(next: Data, done: () => void) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (await commit(next)) done();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function completeShopSetup() {
    if (lock.current) return;
    if (!form.name?.trim() || !form.owner?.trim())
      return Alert.alert("Required fields", "Enter the shop and owner names.");
    if (form.whatsapp && !phoneValid(form.whatsapp))
      return Alert.alert("Invalid WhatsApp number", "Enter a valid 10-digit mobile number.");
    const connectivity = await checkConnectivity(true);
    if (connectivity === "offline")
      return Alert.alert(
        "You’re offline",
        "Shop registration requires a connection to verify and create your shop safely.",
      );
    lock.current = true;
    setBusy(true);
    try {
      const registered = api.normalizeData(await api.registerShop({
        name: form.name.trim(),
        owner: form.owner.trim(),
        address: String(form.address || "").trim(),
        whatsapp: String(form.whatsapp || "").trim(),
        language: data.language,
      }));
      if (!registered.shopExists)
        throw new Error("Shop registration could not be confirmed. Please retry.");
      const accountId = accountKey(registered.shop.phone);
      offlineAccountRef.current = offlineStorageAvailable() ? accountId : null;
      dataRef.current = registered;
      persistedRef.current = registered;
      setData(registered);
      if (offlineAccountRef.current) {
        try { await cacheAuthenticatedAccount(accountId, registered); }
        catch {
          offlineAccountRef.current = null;
          Alert.alert("Offline data unavailable", "Your shop is registered, but encrypted offline storage could not be updated on this device.");
        }
      }
      setHistory([]);
      if (registered.shopComplete) setRoute({ screen: "home" });
      else {
        setForm({
          name: registered.shop.name,
          owner: registered.shop.owner,
          address: registered.shop.address,
          phone: registered.shop.phone,
          whatsapp: registered.shop.whatsapp,
        });
        setRoute({ screen: "setup" });
      }
    } catch (error) {
      Alert.alert("Unable to set up your shop", errorMessage(error, "No shop was created. Check your connection and try again."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function retryFailedSync() {
    const accountId = offlineAccountRef.current;
    if (!accountId || lock.current) return;
    const connection = await checkConnectivity(true);
    if (connection === "offline") {
      Alert.alert(
        "You’re offline",
        "Connect to Wi-Fi or another network before retrying synchronization.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const count = await retryFailedChanges(accountId);
      if (!count) {
        await refreshSyncStatus(accountId);
        return;
      }
      syncNotice.current = null;
      await synchronizeAccount(accountId);
      const status = await readSyncQueueStatus(accountId);
      setSyncStatus(status);
      if (status.failed || status.conflicts || status.pending)
        Alert.alert(
          "Some changes still need attention",
          "Your data remains saved on this phone. Review the sync status and resolve any transaction conflicts.",
        );
      else
        Alert.alert("Synchronization complete", "All saved changes are synchronized.");
    } catch (error) {
      await refreshSyncStatus(accountId);
      showSyncFailure(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function promptNextConflict(accountId: string) {
    if (promptingConflict.current !== null || offlineAccountRef.current !== accountId) return;
    let customerConflict: PendingCustomerConflict | undefined;
    try { [customerConflict] = await readPendingCustomerConflicts(accountId); } catch { return; }
    if (customerConflict) {
      promptingConflict.current = customerConflict.queueId;
      const performCustomer = async (choice: "keep_local" | "keep_server") => {
        try {
          const selected = await chooseCustomerConflictResolution(customerConflict.queueId, choice);
          const result = await api.resolveCustomerConflict(selected, choice);
          await completeCustomerConflict(accountId, customerConflict, result.customer, result.serverVersion, result.resolutionVersion, result.audit);
          promptingConflict.current = null;
          localRevision.current += 1;
          const cached = await readCachedAccount(accountId);
          if (cached && offlineAccountRef.current === accountId) {
            dataRef.current = cached;
            persistedRef.current = cached;
            setData(cached);
          }
          void synchronizeAccount(accountId).then((remote) => {
            if (remote && offlineAccountRef.current === accountId) {
              dataRef.current = remote;
              persistedRef.current = remote;
              setData(remote);
            }
          }).catch(() => {});
          setTimeout(() => void promptNextConflict(accountId), 0);
        } catch (error) {
          if (error instanceof api.ApiError && error.payload?.code === "CUSTOMER_LIMIT_REACHED") {
            promptingConflict.current = null;
            Alert.alert("Customer limit reached", "The server’s current plan does not allow this customer to be restored. The customer conflict remains saved on this phone. Upgrade the plan or choose Keep server when connected.");
            return;
          }
          if (error instanceof api.ApiError && error.status === 409 && error.payload?.code === "CUSTOMER_CONFLICT_RESOLVED" && error.payload?.audit) {
            await completeCustomerConflict(accountId, customerConflict, error.payload.current ?? null, error.payload.serverVersion || error.payload.current?.serverVersion || customerConflict.expectedVersion, error.payload.resolutionVersion || error.payload.current?.resolutionVersion || customerConflict.expectedResolutionVersion, error.payload.audit);
            promptingConflict.current = null;
            Alert.alert("Customer conflict resolved", "Another device already resolved this customer change. The server version has been saved on this phone.");
            const cached = await readCachedAccount(accountId);
            if (cached && offlineAccountRef.current === accountId) {
              dataRef.current = cached;
              persistedRef.current = cached;
              setData(cached);
            }
            setTimeout(() => void promptNextConflict(accountId), 0);
            return;
          }
          if (error instanceof api.ApiError && error.status === 409) {
            await refreshCustomerConflict(customerConflict.queueId, error.payload?.current ?? null, error.payload?.serverVersion, error.payload?.resolutionVersion);
            promptingConflict.current = null;
            Alert.alert("Customer changed again", "The server has a newer customer record. Review the updated conflict before choosing.");
            setTimeout(() => void promptNextConflict(accountId), 250);
            return;
          }
          promptingConflict.current = null;
          Alert.alert("Unable to resolve customer conflict", "Both customer versions remain saved on this phone. Reconnect and try again.");
        }
      };
      const online = (await checkConnectivity()) === "online";
      const buttons = online
        ? customerConflict.chosen
          ? [{ text: customerConflict.chosen === "keep_local" ? "Retry phone choice" : "Retry server choice", onPress: () => void performCustomer(customerConflict.chosen!) }]
          : [
              { text: "Keep phone", onPress: () => void performCustomer("keep_local") },
              { text: "Keep server", onPress: () => void performCustomer("keep_server") },
            ]
        : [];
      Alert.alert(
        "Customer Conflict Detected",
        `${customerConflict.local.name}\n\nThis customer was changed on another device while this phone was offline. The phone and server versions are preserved.`,
        [...buttons, { text: "Resolve Later", style: "cancel" as const, onPress: () => { promptingConflict.current = null; } }],
      );
      return;
    }
    let settingsConflict: PendingSettingsConflict | undefined;
    try { [settingsConflict] = await readPendingSettingsConflicts(accountId); } catch { return; }
    if (settingsConflict) {
      promptingConflict.current = settingsConflict.queueId;
      const serverSettings = (value: any) => ({
        shop: {
          name: value.name, owner: value.owner, address: value.address,
          phone: String(value.phone || "").replace(/^\+91/, ""), whatsapp: value.whatsapp,
          serverVersion: value.serverVersion,
          resolutionVersion: value.resolutionVersion,
        },
        language: value.language,
        defaultMethod: value.defaultMethod,
        reminders: value.reminders,
      });
      const finish = async (settings: typeof settingsConflict.server, audit: Data["audit"][number]) => {
        await completeSettingsConflict(accountId, settingsConflict, settings, audit);
        promptingConflict.current = null;
        localRevision.current += 1;
        const cached = await readCachedAccount(accountId);
        if (cached && offlineAccountRef.current === accountId) {
          dataRef.current = cached;
          persistedRef.current = cached;
          setData(cached);
        }
        void synchronizeAccount(accountId).catch(() => {});
        setTimeout(() => void promptNextConflict(accountId), 0);
      };
      const performSettings = async (choice: "keep_local" | "keep_server") => {
        try {
          const selected = await chooseSettingsConflictResolution(settingsConflict.queueId, choice);
          const result = await api.resolveSettingsConflict(selected, choice);
          await finish(result.settings, result.audit);
        } catch (error) {
          if (error instanceof api.ApiError && error.status === 409 && error.payload?.code === "SHOP_CONFLICT_RESOLVED" && error.payload?.audit) {
            await finish(serverSettings(error.payload.current), error.payload.audit);
            Alert.alert("Settings conflict resolved", "Another device already resolved these settings. The server version is now saved on this phone.");
            return;
          }
          if (error instanceof api.ApiError && error.status === 409 && error.payload?.current) {
            await refreshSettingsConflict(settingsConflict.queueId, error.payload.current);
            promptingConflict.current = null;
            Alert.alert("Settings changed again", "The server has newer settings. Review the updated conflict before choosing.");
            setTimeout(() => void promptNextConflict(accountId), 250);
            return;
          }
          promptingConflict.current = null;
          Alert.alert("Unable to resolve settings conflict", "Both versions remain saved on this phone. Reconnect and try again.");
        }
      };
      const online = (await checkConnectivity()) === "online";
      const buttons = online
        ? settingsConflict.chosen
          ? [{ text: settingsConflict.chosen === "keep_local" ? "Retry phone choice" : "Retry server choice", onPress: () => void performSettings(settingsConflict.chosen!) }]
          : [
              { text: "Keep phone", onPress: () => void performSettings("keep_local") },
              { text: "Keep server", onPress: () => void performSettings("keep_server") },
            ]
        : [];
      Alert.alert(
        "Shop Settings Conflict",
        "These settings changed on another device while this phone was offline. Both versions are preserved.",
        [...buttons, { text: "Resolve Later", style: "cancel" as const, onPress: () => { promptingConflict.current = null; } }],
      );
      return;
    }
    let conflict: PendingConflict | undefined;
    try { [conflict] = await readPendingConflicts(accountId); } catch { return; }
    if (!conflict || promptingConflict.current !== null) return;
    promptingConflict.current = conflict.queueId;
    const serverEntry = conflict.server;
    const localCustomer = dataRef.current.customers.find((item) => item.id === conflict.local.customerId);
    const serverCustomer = serverEntry ? dataRef.current.customers.find((item) => item.id === serverEntry.customerId) : undefined;
    const describe = (entry: NonNullable<PendingConflict["server"]>, name?: string) =>
      `${money(entry.amount)} ${entryLabel(entry.type)} · ${name || "customer"} · ${entry.date}${entry.note ? ` · ${entry.note}` : ""}`;
    const localText = conflict.localDeleted ? "Deleted on this phone" : describe(conflict.local, localCustomer?.name);
    const serverText = serverEntry ? describe(serverEntry, serverCustomer?.name) : "Deleted on server";
    const localAmount = money(conflict.local.amount);
    const serverAmount = conflict.server ? money(conflict.server.amount) : "deleted";
    let impact = "";
    if (serverEntry && !conflict.localDeleted && serverEntry.customerId === conflict.local.customerId) {
      const localSigned = conflict.local.amount * (conflict.local.type === "payment" ? -1 : 1);
      const serverSigned = serverEntry.amount * (serverEntry.type === "payment" ? -1 : 1);
      const difference = localSigned - serverSigned;
      if (difference) impact = `\nEstimated ${customer?.name || "customer"} outstanding change if you keep the phone value: ${difference > 0 ? "+" : "−"}${money(Math.abs(difference))}.`;
    }
    const message = `Saved on this phone: ${localText}\nSaved on server: ${serverText}${impact}`;
    const perform = async (choice: "keep_local" | "keep_server") => {
      try {
        const selectedConflict = await chooseConflictResolution(conflict.queueId, choice);
        const result = await api.resolveFinancialConflict(selectedConflict, choice);
        await completeConflict(accountId, conflict, result.entry, result.serverVersion, result.resolutionVersion, result.audit);
        promptingConflict.current = null;
        localRevision.current += 1;
        const cached = await readCachedAccount(accountId);
        if (cached && offlineAccountRef.current === accountId) {
          dataRef.current = cached;
          persistedRef.current = cached;
          setData(cached);
        }
        void synchronizeAccount(accountId).then((remote) => {
          if (remote && offlineAccountRef.current === accountId) {
            dataRef.current = remote;
            persistedRef.current = remote;
            setData(remote);
          }
        }).catch(() => {});
        setTimeout(() => void promptNextConflict(accountId), 0);
      } catch (error) {
        if (error instanceof api.ApiError && error.status === 409) {
          await refreshConflict(conflict.queueId, error.payload?.current ?? null, error.payload?.serverVersion, error.payload?.resolutionVersion);
          promptingConflict.current = null;
          Alert.alert("Transaction changed again", "The server has a newer value. Review the updated conflict before choosing.");
          setTimeout(() => void promptNextConflict(accountId), 250);
          return;
        }
        promptingConflict.current = null;
        Alert.alert("Unable to resolve conflict", "Your phone and server values are still saved. Reconnect and try again.");
      }
    };
    const online = (await checkConnectivity()) === "online";
    const buttons = online
      ? conflict.chosen
        ? [{ text: conflict.chosen === "keep_local" ? "Retry phone choice" : "Retry server choice", onPress: () => void perform(conflict.chosen!) }]
        : [
            { text: conflict.localDeleted ? "Keep phone deletion" : `Keep phone (${localAmount})`, onPress: () => void perform("keep_local") },
            { text: serverEntry ? `Keep server (${serverAmount})` : "Keep server deletion", onPress: () => void perform("keep_server") },
          ]
      : [];
    Alert.alert(
      "Transaction Conflict Detected",
      `${localCustomer?.name ? `${localCustomer.name}\n` : ""}This transaction was modified while your phone was offline.\n\n${message}`,
      [...buttons, { text: "Resolve Later", style: "cancel" as const, onPress: () => { promptingConflict.current = null; } }],
    );
  }
  function go(screen: Screen, id?: string, reset = false) {
    setHistory(reset ? [] : [...history, route]);
    setRoute({ screen, id });
    setSearch("");
    setFilter("All");
    setFaq("");
    if (screen === "customerForm") {
      const c = data.customers.find((x) => x.id === id);
      setForm(
        c
          ? {
              name: c.name,
              phone: c.phone,
              address: c.address,
              opening: String(c.opening),
              openingAdvance: String(c.openingAdvance || 0),
              limit: String(c.limit),
              reminder: String(c.reminder),
            }
          : {
              name: "",
              phone: "",
              address: "",
              opening: "0",
              openingAdvance: "0",
              limit: "10000",
              reminder: "false",
            },
      );
    }
    if (
      screen === "credit" ||
      screen === "payment" ||
      screen === "refund" ||
      screen === "editTransaction"
    ) {
      const e =
        screen === "editTransaction"
          ? data.entries.find((x) => x.id === id)
          : undefined;
      setForm({
        customerId:
          e?.customerId ||
          id ||
          (screen === "credit" ? "" : data.customers[0]?.id) ||
          "",
        amount: e ? String(e.amount) : "",
        date: e?.date || today(),
        recordedAt: e?.recordedAt || new Date().toISOString(),
        note: e?.note || "",
        method: e?.method || data.defaultMethod,
        reference: e?.reference || "",
        due: e?.due || "",
      });
    }
    if (screen === "setup") setForm({
      name: data.shop.name,
      owner: data.shop.owner,
      address: data.shop.address,
      phone: data.shop.phone,
      whatsapp: data.shop.whatsapp,
    });
    if (screen === "share" && id) setForm({ message: statementText(id) });
    if (screen === "statement" && id) {
      const createdAt = data.customers.find((c) => c.id === id)?.createdAt;
      const earliestMonth = createdAt ? monthForDate(createdAt) : undefined;
      if (earliestMonth && month < earliestMonth) setMonth(earliestMonth);
      else if (month > today().slice(0, 7)) setMonth(today().slice(0, 7));
    }
  }
  const f = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const field = (
    label: string,
    key: string,
    extra: Record<string, unknown> = {},
  ) => (
    <Field
      label={label}
      value={form[key] || ""}
      onChangeText={(v) => f(key, v)}
      {...extra}
    />
  );
  const customer = data.customers.find((c) => c.id === route.id);
  const entry = data.entries.find((e) => e.id === route.id);
  const outstanding = data.customers.reduce(
    (sum, c) => sum + Math.max(0, balance(data, c.id)),
    0,
  );
  const financial = financialSummary(data);
  const monthEntries = data.entries.filter((e) => e.date.startsWith(month));
  const totalCredit = periodUdhari(data, month);
  const totalPayment = periodReceived(data, month);
  const isOverdue = (c: Customer) =>
    balance(data, c.id) > 0 &&
    data.entries.some(
      (e) =>
        e.customerId === c.id &&
        e.type === "credit" &&
        e.due &&
        e.due < today(),
    );
  function statementText(id: string) {
    const c = data.customers.find((c) => c.id === id);
    const m = monthly(data, id, month);
    return `Hello ${c?.name},\nYour ${monthLabel(month)} khata from ${data.shop.name}:\n\nOpening: ${money(m.opening)}\nUdhari: ${money(m.credit)}\nPayment: ${money(m.payment)}\nOutstanding: ${money(m.closing)}\n\nThank you!`;
  }
  function changeMonth(
    delta: number,
    earliestMonth?: string,
    latestMonth?: string,
  ) {
    const date = new Date(`${month}-01T12:00:00`);
    date.setMonth(date.getMonth() + delta);
    const nextMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (
      (earliestMonth && nextMonth < earliestMonth) ||
      (latestMonth && nextMonth > latestMonth)
    )
      return;
    setMonth(nextMonth);
  }
  const monthPicker = (earliestMonth?: string, latestMonth?: string) => (
    <View
      style={[
        s.split,
        { justifyContent: "space-between", alignItems: "center" },
      ]}
    >
      <Pressable
        accessibilityLabel="Previous month"
        disabled={Boolean(earliestMonth && month <= earliestMonth)}
        onPress={() => changeMonth(-1, earliestMonth, latestMonth)}
        style={{ padding: 10, opacity: earliestMonth && month <= earliestMonth ? 0.35 : 1 }}
      >
        <Icon name="chevron-back" />
      </Pressable>
      <Text style={s.rowTitle}>{monthLabel(month)}</Text>
      <Pressable
        accessibilityLabel="Next month"
        disabled={Boolean(latestMonth && month >= latestMonth)}
        onPress={() => changeMonth(1, earliestMonth, latestMonth)}
        style={{ padding: 10, opacity: latestMonth && month >= latestMonth ? 0.35 : 1 }}
      >
        <Icon name="chevron-forward" />
      </Pressable>
    </View>
  );
  const stat = (label: string, value: string, pale = false) => (
    <Card style={{ flex: 1, backgroundColor: pale ? colors.pale : "white" }}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.stat}>{value}</Text>
    </Card>
  );
  const actions = (id?: string) => (
    <>
      <View style={s.split}>
        <View style={{ flex: 1 }}>
          <Button title="+ Give Udhari" onPress={() => go("credit", id)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Receive Money / Add Advance" orange onPress={() => go("payment", id)} />
        </View>
      </View>
      {id && balance(data, id) < 0 && (
        <Button title="Refund Advance (एडवांस वापस करें)" secondary onPress={() => go("refund", id)} />
      )}
    </>
  );
  const customerRow = (c: Customer) => (
    <Pressable
      key={c.id}
      onPress={() => go("customer", c.id)}
      accessibilityRole="button"
    >
      <Card>
        <View style={[s.split, { alignItems: "center" }]}>
          <View style={s.avatar}>
            <Text style={{ color: colors.green, fontWeight: "700" }}>
              {c.name[0]?.toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>{c.name}</Text>
            <Text style={s.small}>
              {isOverdue(c) ? "Overdue • " : ""}
              {c.phone || "No phone added"}
            </Text>
          </View>
          <Text style={{ color: colors.green, fontWeight: "700" }}>
            {balance(data, c.id) < 0
              ? `Advance ${money(-balance(data, c.id))}`
              : money(balance(data, c.id))}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
  const entryRow = (e: Entry) => (
    <Pressable
      key={e.id}
      accessibilityRole="button"
      onPress={() => go("transaction", e.id)}
    >
      <Card>
        <View style={[s.split, { alignItems: "center" }]}>
          <View style={s.avatar}>
            <Icon
              name={
                e.type === "credit"
                  ? "bag-handle-outline"
                  : "arrow-down-outline"
              }
              size={20}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>
              {data.customers.find((c) => c.id === e.customerId)?.name}
            </Text>
            <Text style={s.small}>
              {entryLabel(e.type)} • {e.date}
            </Text>
          </View>
          <Text
            style={{
              fontWeight: "700",
              color: e.type === "payment" ? colors.orange : colors.green,
            }}
          >
            {entrySign(e.type)}
            {money(e.amount)}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
  function saveCustomer() {
    const name = form.name?.trim();
    const normalizedPhone = normalizeCustomerMobile(form.phone);
    const opening = Number(form.opening || 0),
      openingAdvance = Number(form.openingAdvance || 0),
      limit = Number(form.limit || 0);
    if (!name)
      return Alert.alert("Name required", "Enter the customer’s name.");
    if (form.phone?.trim() && normalizedPhone === null)
      return Alert.alert(
        "Invalid phone",
        "Enter a valid Indian mobile number, such as 9876543210 or +91 9876543210.",
      );
    if (normalizedPhone) {
      const duplicate = data.customers.find((item) =>
        item.id !== route.id && normalizeCustomerMobile(item.phone) === normalizedPhone,
      );
      if (duplicate)
        return Alert.alert(
          "Mobile number already used",
          "A customer with this mobile number already exists in your shop. Please open the existing customer.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Customer", onPress: () => go("customer", duplicate.id) },
          ],
        );
    }
    if (
      !Number.isFinite(opening) ||
      opening < 0 ||
      opening > 1e9 ||
      !Number.isFinite(openingAdvance) ||
      openingAdvance < 0 ||
      openingAdvance > 1e9 ||
      [opening, openingAdvance, limit].some(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) > 0.00001,
      ) ||
      !Number.isFinite(limit) ||
      limit < 0 ||
      limit > 1e9
    )
      return Alert.alert(
        "Invalid balance",
        "Opening balances and credit limit must be between ₹0 and ₹100 crore.",
      );
    const existingCustomer = data.customers.find((x) => x.id === route.id);
    const c: Customer = {
      id: route.id || uid(),
      serverVersion: existingCustomer?.serverVersion,
      createdAt: existingCustomer?.createdAt || new Date().toISOString(),
      openingDate:
        existingCustomer?.openingDate ||
        existingCustomer?.createdAt?.slice(0, 10) ||
        (!route.id ? today() : undefined),
      name,
      phone: normalizedPhone || "",
      address: form.address.trim(),
      opening: Math.round(opening * 100) / 100,
      openingAdvance: Math.round(openingAdvance * 100) / 100,
      limit: Math.round(limit * 100) / 100,
      reminder: form.reminder === "true",
    };
    const entitlement = subscriptionSnapshot?.current?.plan;
    const localCustomerLimit = entitlement?.customerLimit ?? 50;
    const hasUnlimitedCustomers = entitlement?.unlimitedCustomers ?? false;
    if (
      !route.id &&
      !hasUnlimitedCustomers &&
      data.customers.length >= localCustomerLimit
    )
      return Alert.alert(
        "Customer limit reached",
        `Your ${entitlement?.name || "Free"} plan allows ${localCustomerLimit} customers. Upgrade your plan to add another customer.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "View plans", onPress: () => go("subscription") },
        ],
      );
    save(
      {
        ...data,
        customers: route.id
          ? data.customers.map((x) => (x.id === route.id ? c : x))
          : [...data.customers, c],
        audit: [
          {
            id: uid(),
            action: `${route.id ? "Updated" : "Added"} customer: ${name}`,
            date: new Date().toISOString(),
          },
          ...data.audit,
        ],
      },
      () => go("customer", c.id, true),
    );
  }
  function saveEntry() {
    const old = route.screen === "editTransaction" ? entry : undefined;
    const type = old?.type ||
      (route.screen === "credit" ? "credit" : route.screen === "refund" ? "refund" : "payment");
    const amount = Number(form.amount);
    const c = data.customers.find((c) => c.id === form.customerId);
    if (!c)
      return Alert.alert(
        "Select a customer",
        "Add a customer before recording a transaction.",
      );
    if (
      !Number.isFinite(amount) ||
      amount < 0.01 ||
      amount > 1e9 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001
    )
      return Alert.alert(
        "Invalid amount",
        "Enter an amount from ₹0.01 to ₹100 crore, with no more than two decimal places.",
      );
    if (!validDate(form.date) || (form.due && !validDate(form.due)))
      return Alert.alert(
        "Invalid date",
        "Use a valid date in YYYY-MM-DD format.",
      );
    if (form.due && form.due < form.date)
      return Alert.alert(
        "Invalid due date",
        "Due date cannot be before the transaction date.",
      );
    const amountPaise = Math.round(amount * 100);
    const oldSignedPaise = old
      ? Math.round(old.amount * 100) * (old.type === "payment" ? -1 : 1)
      : 0;
    // Preview/validation uses the balance before the transaction being edited;
    // the server will then reallocate the full chronological ledger atomically.
    const currentPaise = Math.round(balance(data, c.id) * 100) - oldSignedPaise;
    if (type === "refund" && (currentPaise >= 0 || amountPaise > -currentPaise))
      return Alert.alert("Insufficient advance", "A refund cannot exceed the customer’s available advance.");
    const appliedToUdhariPaise = type === "payment"
      ? Math.min(Math.max(0, currentPaise), amountPaise)
      : 0;
    const addedToAdvancePaise = type === "payment"
      ? amountPaise - appliedToUdhariPaise
      : 0;
    const advanceAppliedPaise = type === "credit"
      ? Math.min(Math.max(0, -currentPaise), amountPaise)
      : 0;
    const e: Entry = {
      id: old?.id || uid(),
      serverVersion: old?.serverVersion,
      customerId: c.id,
      type,
      amount: Math.round(amount * 100) / 100,
      date: form.date,
      recordedAt: old?.recordedAt || form.recordedAt || new Date().toISOString(),
      note: form.note.trim(),
      method: form.method,
      reference: form.reference?.trim() || "",
      due: type === "credit" ? form.due : "",
      appliedToUdhari: appliedToUdhariPaise / 100,
      addedToAdvance: addedToAdvancePaise / 100,
      advanceApplied: advanceAppliedPaise / 100,
    };
    const next = {
      ...data,
      entries: old
        ? data.entries.map((x) => (x.id === old.id ? e : x))
        : [e, ...data.entries],
      audit: [
        {
          id: uid(),
          action: old
            ? "Edited transaction"
            : `Recorded ${type === "credit" ? "Udhari" : type === "refund" ? "Advance Refund" : "Payment Received"}`,
          date: new Date().toISOString(),
          ...(old ? { before: old } : {}),
          after: e,
        },
        ...data.audit,
      ],
    };
    const apply = () => save(next, () => go("customer", c.id, true));
    if (type === "payment") {
      Alert.alert(
        "Confirm money received",
        `Amount Received: ${money(amountPaise / 100)}\nAdjusted Against Udhari: ${money(appliedToUdhariPaise / 100)}\nAdded to Advance: ${money(addedToAdvancePaise / 100)}`,
        [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: apply }],
      );
      return;
    }
    if (type === "credit" && advanceAppliedPaise > 0) {
      const newOutstandingPaise = Math.max(0, currentPaise + amountPaise);
      Alert.alert(
        "Confirm Udhari",
        `Purchase Amount: ${money(amountPaise / 100)}\nAdjusted From Advance: ${money(advanceAppliedPaise / 100)}\nNew Outstanding: ${money(newOutstandingPaise / 100)}`,
        [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: apply }],
      );
      return;
    }
    if (type === "refund") {
      Alert.alert(
        "Confirm advance refund",
        `Refund: ${money(amountPaise / 100)}\nRemaining Advance: ${money((-currentPaise - amountPaise) / 100)}`,
        [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: apply }],
      );
      return;
    }
    if (type === "credit" && c.limit > 0 && balance(next, c.id) > c.limit)
      Alert.alert(
        "Credit limit exceeded",
        `This takes ${c.name} above their ${money(c.limit)} credit limit.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Save anyway", onPress: apply },
        ],
      );
    else apply();
  }
  function deleteEntry(e: Entry) {
    Alert.alert(
      "Delete transaction?",
      `Remove this ${money(e.amount)} entry? The change will remain in Activity History.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            save(
              {
                ...data,
                entries: data.entries.filter((x) => x.id !== e.id),
                audit: [
                  {
                    id: uid(),
                    action: "Deleted transaction",
                    date: new Date().toISOString(),
                    before: e,
                  },
                  ...data.audit,
                ],
              },
              () => go("customer", e.customerId, true),
            ),
        },
      ],
    );
  }
  async function exportData(backup: boolean) {
    try {
      const quote = (x: unknown) => {
        const raw = String(x);
        const safe =
          typeof x === "string" && /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const csv = [
        "Customer,Type,Amount,Date,Description,Method",
        ...data.customers
          .filter((c) => c.opening !== 0)
          .map((c) =>
            [c.name, "opening", c.opening, "", "Opening outstanding", ""]
              .map(quote)
              .join(","),
          ),
        ...data.entries.map((e) =>
          [
            data.customers.find((c) => c.id === e.customerId)?.name,
            e.type,
            e.amount,
            e.date,
            e.note,
            e.method,
          ]
            .map(quote)
            .join(","),
        ),
      ].join("\n");
      const file = new File(
        Paths.cache,
        backup ? "digital-khata-backup.json" : "digital-khata-ledger.csv",
      );
      file.write(backup ? JSON.stringify(data, null, 2) : csv);
      await Sharing.shareAsync(file.uri, {
        mimeType: backup ? "application/json" : "text/csv",
        dialogTitle: backup ? "Save your khata backup" : "Export ledger",
      });
    } catch {
      Alert.alert("Export failed", "Please try again.");
    }
  }
  async function deleteLocalAccount() {
    try {
      for (const name of [
        "digital-khata-backup.json",
        "digital-khata-ledger.csv",
      ]) {
        const file = new File(Paths.cache, name);
        if (file.exists) file.delete();
      }
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      const offlineAccountId = offlineAccountRef.current;
      await api.deleteAccount();
      if (offlineAccountId) await clearOfflineAccount(offlineAccountId);
      if (offlineAccountId) await cancelSubscriptionNotifications(offlineAccountId);
      offlineAccountRef.current = null;
      dataRef.current = initialData;
      setData(initialData);
      persistedRef.current = null;
      setPhone("");
      setOtp("");
      setForm({});
      go("welcome", undefined, true);
    } catch {
      Alert.alert(
        "Unable to delete",
        "Could not remove cached exports. Please restart the app and try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function restore() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const parsed = JSON.parse(await new File(result.assets[0].uri).text());
      if (!validBackup(parsed))
        return Alert.alert(
          "Invalid backup",
          "This file is not a valid Digital Khata backup.",
        );
      Alert.alert(
        "Replace cloud data?",
        `Restore ${parsed.customers.length} customers and ${parsed.entries.length} transactions? Current cloud records will be replaced.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Restore",
            onPress: async () => {
              if (lock.current) return;
              lock.current = true;
              setBusy(true);
              try {
                  const restored = await api.restoreBackup({ ...parsed, signedIn: true });
                  const accountId = offlineAccountRef.current;
                  if (accountId && offlineStorageAvailable())
                    await cacheAuthenticatedAccount(accountId, restored).catch(() =>
                      Alert.alert(
                        "Backup restored online",
                        "The server restore succeeded, but the encrypted offline cache could not be refreshed on this device.",
                      ),
                    );
                  dataRef.current = restored;
                  setData(restored);
                  persistedRef.current = restored;
                go("home", undefined, true);
              } catch (error) {
                Alert.alert("Restore failed", errorMessage(error, "Please try again."));
              } finally { lock.current = false; setBusy(false); }
            },
          },
        ],
      );
    } catch {
      Alert.alert(
        "Restore failed",
        "Select a valid Digital Khata JSON backup.",
      );
    }
  }
  async function sendStatement() {
    if (!customer?.phone)
      return Alert.alert(
        "Phone number required",
        "Edit the customer and add a valid mobile number first.",
      );
    if (!customer.reminder)
      return Alert.alert(
        "Customer opted out",
        "This customer has disabled WhatsApp/SMS reminders.",
      );
    try {
      const message = encodeURIComponent(form.message);
      await Linking.openURL(
        channel === "WhatsApp"
          ? `https://wa.me/91${customer.phone}?text=${message}`
          : `sms:+91${customer.phone}?body=${message}`,
      );
    } catch {
      Alert.alert("Unable to open app", `Please install or enable ${channel}.`);
    }
  }
  let content: React.ReactNode = null;
  switch (route.screen) {
    case "welcome":
      content = (
        <>
          <View style={{ paddingTop: 32 }}>
            <View style={s.logo}>
              <Text style={{ fontSize: 49, color: "white", fontWeight: "700" }}>
                ₹
              </Text>
            </View>
            <Text style={[s.hero, { textAlign: "center" }]}>
              Welcome to{"\n"}
              <Text style={{ color: colors.green }}>Digital Khata</Text>
            </Text>
            <Text
              style={[
                s.hint,
                { textAlign: "center", marginTop: 15, fontSize: 16 },
              ]}
            >
              Manage customer udhari and payments{"\n"}without the paper
              notebook.
            </Text>
          </View>
          <Card
            style={{
              backgroundColor: colors.pale,
              alignItems: "center",
              padding: 28,
              marginVertical: 15,
            }}
          >
            <Icon name="storefront-outline" size={54} />
            <Title>Simple digital khata</Title>
            <Hint>Udhari ka hisaab, ab aur bhi aasan</Hint>
          </Card>
          <Chips
            items={["English", "हिन्दी"]}
            value={data.language}
            onChange={(language) => commit({ ...data, language })}
          />
          <Button title="Login" onPress={() => go("login")} />
          <Button
            title="Create Account"
            secondary
            onPress={() => go("login")}
          />
          <Hint>
            Sign in securely with your mobile number. Your khata syncs to your account.
          </Hint>
        </>
      );
      break;
    case "login":
      content = (
        <>
          <Title>Enter your mobile number</Title>
          <Hint>Keep your shop’s khata close, wherever you go.</Hint>
          <Field
            label="Mobile number (+91)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            maxLength={10}
            placeholder="98XXXXXXXX"
          />
          <Button
            title="Continue"
            disabled={busy}
            onPress={async () => {
              if (!phoneValid(phone))
                return Alert.alert(
                  "Invalid mobile number",
                  "Enter a valid 10-digit Indian mobile number.",
                );
              const network = await checkConnectivity(true);
              if (network === "offline")
                return Alert.alert(network === "offline" ? "You’re offline" : "Server unavailable", network === "offline" ? "Connect to Wi-Fi or another network to sign in." : "The network is connected, but the Digital-Khata server could not be reached.");
              setBusy(true);
              try {
                const result = await api.startOtp(`+91${phone}`);
                setOtp("");
                setOtpVerified(false);
                setOtpHint(result.developmentCode ? `Local development OTP: ${result.developmentCode}` : "A verification code was sent by SMS.");
                setSeconds(30);
                go("otp");
              } catch (error) {
                showOtpError("Could not send OTP", error, "Please try again.");
              } finally { setBusy(false); }
            }}
          />
          <Card>
            <Hint>
              We’ll send a one-time verification code to your mobile number.
            </Hint>
          </Card>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Network Diagnostics"
            onPress={() => {
              setNetworkDiagnosticsRevision((revision) => revision + 1);
              void refreshSyncStatus();
              setNetworkDiagnosticsVisible(true);
            }}
            style={{ paddingVertical: 8, alignItems: "center" }}
          >
            <Text style={s.link}>Network Diagnostics</Text>
          </Pressable>
        </>
      );
      break;
    case "otp":
      content = (
        <>
          <Title>Enter OTP</Title>
          <Hint>{otpHint || `Verification code sent to +91 ${phone}`}</Hint>
          <Field
            label="Verification code"
            keyboardType="number-pad"
            maxLength={8}
            value={otp}
            onChangeText={setOtp}
            placeholder="• • • • • •"
          />
          <Pressable
            disabled={seconds > 0}
            onPress={async () => {
              const network = await checkConnectivity(true);
              if (network === "offline")
                return Alert.alert(network === "offline" ? "You’re offline" : "Server unavailable", network === "offline" ? "Connect to Wi-Fi or another network to sign in." : "The network is connected, but the Digital-Khata server could not be reached.");
              setSeconds(30);
              try {
                const result = await api.startOtp(`+91${phone}`);
                setOtpVerified(false);
                setOtpHint(result.developmentCode ? `Local development OTP: ${result.developmentCode}` : "A new verification code was sent by SMS.");
              } catch (error) { showOtpError("Could not resend OTP", error, "Please try again."); }
            }}
          >
            <Text style={s.link}>
              {seconds
                ? `Resend OTP in 00:${String(seconds).padStart(2, "0")}`
                : "Resend OTP"}
            </Text>
          </Pressable>
          <Button
            title={otpVerified ? "Continue" : "Verify"}
            disabled={busy}
            onPress={async () => {
              if (!/^\d{4,8}$/.test(otp)) return Alert.alert("Invalid code", "Enter the verification code sent to your phone.");
              const network = await checkConnectivity(true);
              if (network === "offline")
                return Alert.alert(network === "offline" ? "You’re offline" : "Server unavailable", network === "offline" ? "Connect to Wi-Fi or another network to sign in." : "The network is connected, but the Digital-Khata server could not be reached.");
              setBusy(true);
              try {
                let remote: Data;
                if (otpVerified) {
                  remote = api.normalizeData(await api.loadAccount());
                } else {
                  try {
                    remote = api.normalizeData(await api.verifyOtp(`+91${phone}`, otp));
                  } catch (error) {
                    if (error instanceof api.OtpVerifiedAccountLoadError) {
                      setOtpVerified(true);
                      showOtpError(
                        "OTP verified, but account details could not be loaded",
                        error.cause,
                        "Your sign-in is saved. Check your connection and tap Continue to retry.",
                      );
                      return;
                    }
                    throw error;
                  }
                }
                const id = remote.shopExists ? accountKey(remote.shop.phone || `+91${phone}`) : "";
                offlineAccountRef.current = id && offlineStorageAvailable() ? id : null;
                if (id && offlineStorageAvailable()) {
                  try {
                    remote = (await synchronizePendingOnly(id)) || remote;
                  } catch {
                    const cached = await readCachedAccount(id);
                    if (cached && validBackup(cached)) remote = cached;
                  }
                  try { await cacheAuthenticatedAccount(id, remote); }
                  catch {
                    offlineAccountRef.current = null;
                    Alert.alert(
                      "Offline storage unavailable",
                      "Your shop is signed in, but encrypted local storage could not be opened. Offline changes are not enabled on this installation.",
                    );
                  }
                }
                dataRef.current = remote;
                setData(remote);
                persistedRef.current = remote;
                setOtpVerified(false);
                if (remote.shopComplete) go("home", undefined, true);
                else { setHistory([...history, route]); setRoute({ screen: "setup" }); setForm({ name: remote.shop.name, owner: remote.shop.owner, address: remote.shop.address, phone, whatsapp: remote.shop.whatsapp }); }
              } catch (error) { showOtpError(otpVerified ? "Could not load your account" : "Could not verify OTP", error, "Check your connection and try again."); }
              finally { setBusy(false); }
            }}
          />
          <Button
            title="Change mobile number"
            secondary
            onPress={() => { setOtpVerified(false); go("login"); }}
          />
        </>
      );
      break;
    case "setup":
      content = (
        <>
          {data.shopExists === false && (
            <Hint>Complete your shop setup to start using Digital-Khata.</Hint>
          )}
          {field("Shop Name *", "name", {
            placeholder: "Sharma General Store",
          })}
          {field("Owner Name *", "owner", { placeholder: "Rajesh Sharma" })}
          {field("Address", "address", { placeholder: "Delhi" })}
          {field("WhatsApp number (optional)", "whatsapp", {
            keyboardType: "phone-pad",
            maxLength: 10,
            placeholder: "98XXXXXXXX",
          })}
          <Title>Language</Title>
          <Chips
            items={["English", "हिन्दी"]}
            value={data.language}
            onChange={(language) => {
              if (data.shopExists === false) {
                const next = { ...data, language };
                dataRef.current = next;
                setData(next);
              } else void commit({ ...data, language });
            }}
          />
          <Button
            title={data.shopExists !== false ? "Save Profile" : "Start Using Khata"}
            disabled={busy}
            onPress={() => {
              if (!form.name?.trim() || !form.owner?.trim())
                return Alert.alert(
                  "Required fields",
                  "Enter the shop and owner names.",
                );
              if (form.whatsapp && !phoneValid(form.whatsapp))
                return Alert.alert(
                  "Invalid WhatsApp number",
                  "Enter a valid 10-digit mobile number.",
                );
              if (data.shopExists === false) {
                void completeShopSetup();
                return;
              }
              save(
                {
                  ...data,
                  shopExists: true,
                  shopComplete: true,
                  shop: {
                    name: form.name.trim(),
                    owner: form.owner.trim(),
                    address: form.address || "",
                    phone: data.shop.phone,
                    whatsapp: form.whatsapp || "",
                  },
                },
                () => go("home", undefined, true),
              );
            }}
          />
        </>
      );
      break;
    case "home":
      content = (
        <>
          <View style={[s.split, { alignItems: "center" }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.heading, { fontSize: 23 }]}>
                Good{" "}
                {new Date().getHours() < 12
                  ? "Morning"
                  : new Date().getHours() < 17
                    ? "Afternoon"
                    : "Evening"}
                , {data.shop.owner.split(" ")[0]} 👋
              </Text>
              <Hint>{data.shop.name}</Hint>
            </View>
            <Pressable
              accessibilityLabel="Notifications"
              onPress={() => go("notifications")}
            >
              <Icon name="notifications-outline" />
            </Pressable>
          </View>
          <View style={s.split}>
            {stat("Current Outstanding", money(financial.outstandingPaise / 100), true)}
            {stat("Total Udhari", money(financial.totalUdhariPaise / 100))}
          </View>
          <View style={s.split}>
            {stat("Total Money Received", money(financial.totalReceivedPaise / 100))}
            {stat("Udhari Recovered", money(financial.totalUdhariRecoveredPaise / 100))}
          </View>
          <View style={s.split}>
            {stat("Available Advances", money(financial.availableAdvancePaise / 100))}
            {stat("Advance Deposited", money(financial.totalAdvanceDepositedPaise / 100))}
          </View>
          <View style={s.split}>
            {stat("Advance Refunded", money(financial.totalAdvanceRefundedPaise / 100))}
            {stat("Customers", String(data.customers.length))}
          </View>
          <Hint>Current outstanding and advances are balances. The other totals show recorded activity.</Hint>
          {actions()}
          <View style={s.split}>
            {stat(
              "This month’s udhari",
              money(periodUdhari(data, today().slice(0, 7))),
            )}
            {stat(
              "This month’s collection",
              money(periodReceived(data, today().slice(0, 7))),
            )}
          </View>
          <Title>Recent Transactions</Title>
          {data.entries.length ? (
            data.entries
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 4)
              .map(entryRow)
          ) : (
            <Empty
              title="Your khata starts here"
              description="Add your first customer, then record udhari or a payment."
            />
          )}
          <Title>Customers With Pending Balance</Title>
          {data.customers
            .filter((c) => balance(data, c.id) > 0)
            .slice(0, 4)
            .map(customerRow)}
          <Button
            title="+ Add Customer"
            secondary
            onPress={() => go("customerForm")}
          />
        </>
      );
      break;
    case "customers": {
      const list = data.customers.filter(
        (c) =>
          (c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.phone.includes(search)) &&
          (filter === "All" ||
            (filter === "Due" && balance(data, c.id) > 0) ||
            (filter === "Paid" && balance(data, c.id) <= 0) ||
            (filter === "Overdue" && isOverdue(c))),
      );
      content = (
        <>
          <Field
            label="Search customers"
            placeholder="Search name or phone"
            value={search}
            onChangeText={setSearch}
          />
          <Chips
            items={["All", "Due", "Paid", "Overdue"]}
            value={filter}
            onChange={setFilter}
          />
          {list.map(customerRow)}
          {!list.length && (
            <Empty
              title="No customers found"
              description="Add a customer or try a different search."
            />
          )}
          <Button title="+ Add Customer" onPress={() => go("customerForm")} />
        </>
      );
      break;
    }
    case "customerForm":
      content = (
        <>
          {field("Name *", "name", { placeholder: "Rahul Kumar" })}
          {field("Phone Number", "phone", {
            keyboardType: "phone-pad",
            maxLength: 32,
            placeholder: "98XXXXXXXX",
          })}
          {field("Address", "address", { placeholder: "Delhi" })}
          {field("Opening Outstanding (₹)", "opening", {
            keyboardType: "decimal-pad",
            editable: !route.id,
          })}
          {field("Opening Advance (जमा राशि) (₹)", "openingAdvance", {
            keyboardType: "decimal-pad",
            editable: !route.id,
          })}
          {route.id ? (
            <Hint>
              Opening balances are fixed after creation. Use ledger transactions
              to record later payments or advance deposits.
            </Hint>
          ) : (
            <Hint>
              Opening outstanding is money already owed; opening advance is money
              already deposited. If both are entered, they are netted into one
              opening balance.
            </Hint>
          )}
          {field("Credit Limit (₹, 0 = no limit)", "limit", {
            keyboardType: "decimal-pad",
          })}
          <Toggle
            label="Allow WhatsApp / SMS reminders"
            value={form.reminder === "true"}
            onChange={(v) => f("reminder", String(v))}
          />
          <Button
            title="Save Customer"
            disabled={busy}
            onPress={saveCustomer}
          />
        </>
      );
      break;
    case "customer":
      if (customer) {
        const entries = data.entries.filter(
          (e) => e.customerId === customer.id,
        );
        const customerFinancial = financialSummary(data, customer.id);
        const currentOutstandingPaise = customerFinancial.outstandingPaise;
        const availableAdvancePaise = customerFinancial.availableAdvancePaise;
        content = (
          <>
            <Hint>
              {customer.phone || "No phone number"} •{" "}
              {customer.address || "No address"}
            </Hint>
            <Card style={{ backgroundColor: colors.pale }}>
              <Hint>Current Outstanding</Hint>
              <Text style={s.amount}>{money(currentOutstandingPaise / 100)}</Text>
              <Hint>Available Advance: {money(availableAdvancePaise / 100)}</Hint>
            </Card>
            {actions(customer.id)}
            <View style={s.split}>
              {stat(
                "Total Udhari",
                money(totalUdhari(data, customer.id)),
              )}
              {stat(
                "Total Money Received",
                money(customerFinancial.totalReceivedPaise / 100),
              )}
            </View>
            <View style={s.split}>
              {stat("Udhari Recovered", money(customerFinancial.totalUdhariRecoveredPaise / 100))}
              {stat("Advance Deposited", money(customerFinancial.totalAdvanceDepositedPaise / 100))}
            </View>
            <View style={s.split}>
              {stat("Advance Refunded", money(customerFinancial.totalAdvanceRefundedPaise / 100))}
              {stat("Available Advance", money(availableAdvancePaise / 100))}
            </View>
            <View style={s.split}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Statement"
                  secondary
                  onPress={() => go("statement", customer.id)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Edit Customer"
                  secondary
                  onPress={() => go("customerForm", customer.id)}
                />
              </View>
            </View>
            <Title>Transaction History</Title>
            {customer.opening > 0 && (
              <Row title="Opening Udhari" subtitle={customer.openingDate || customer.createdAt?.slice(0, 10)} value={`+${money(customer.opening)}`} />
            )}
            {(customer.openingAdvance || 0) > 0 && (
              <Row title="Opening Advance (जमा राशि)" subtitle={customer.openingDate || customer.createdAt?.slice(0, 10)} value={`−${money(customer.openingAdvance || 0)}`} />
            )}
            {customer.opening > 0 && (customer.openingAdvance || 0) > 0 && (
              <Row
                title="Opening Advance Adjusted Against Udhari"
                subtitle={`Remaining advance: ${money(Math.max(0, customer.openingAdvance! - customer.opening))}`}
                value={money(Math.min(customer.opening, customer.openingAdvance || 0))}
              />
            )}
            {entries
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .map(entryRow)}
            {!entries.length && !customer.opening && !customer.openingAdvance && (
              <Empty
                title="No transactions yet"
                description="Opening outstanding is included in the outstanding amount."
              />
            )}
          </>
        );
      }
      break;
    case "credit":
    case "payment":
    case "refund":
    case "editTransaction":
      content = (
        <>
          {(route.screen === "credit" || route.screen === "refund") && route.id ? (
            <>
              <Field
                label="Customer"
                value={
                  data.customers.find((c) => c.id === route.id)?.name || ""
                }
                editable={false}
              />
            </>
          ) : route.screen !== "editTransaction" ? (
            <>
              <Field
                label="Find a customer"
                value={search}
                onChangeText={setSearch}
                placeholder="Search name or phone"
              />
              <ScrollView
                style={{
                  maxHeight: 180,
                  backgroundColor: "white",
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 9,
                  paddingHorizontal: 12,
                }}
                nestedScrollEnabled
              >
                {data.customers
                  .filter(
                    (c) =>
                      c.name.toLowerCase().includes(search.toLowerCase()) ||
                      c.phone.includes(search),
                  )
                  .map((c) => (
                    <Pressable
                      key={c.id}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: form.customerId === c.id,
                      }}
                      onPress={() => f("customerId", c.id)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        padding: 12,
                        marginVertical: 4,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor:
                          form.customerId === c.id
                            ? colors.green
                            : colors.border,
                        backgroundColor:
                          form.customerId === c.id ? colors.green : "white",
                        opacity: pressed ? 0.8 : 1,
                      })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color:
                              form.customerId === c.id ? "white" : colors.dark,
                            fontSize: 15,
                            fontWeight: "600",
                          }}
                        >
                          {c.name}
                        </Text>
                        <Text
                          style={{
                            color:
                              form.customerId === c.id
                                ? "#E7FFF0"
                                : colors.muted,
                            fontSize: 12,
                            marginTop: 5,
                          }}
                        >
                          {[
                            c.phone,
                            c.address,
                            `Balance ${money(balance(data, c.id))}`,
                          ]
                            .filter(Boolean)
                            .join(" • ")}
                        </Text>
                      </View>
                      {form.customerId === c.id && (
                        <Icon name="checkmark-circle" color="white" size={20} />
                      )}
                    </Pressable>
                  ))}
              </ScrollView>
            </>
          ) : null}
          {!data.customers.length ? (
            <Button title="+ Add Customer" onPress={() => go("customerForm")} />
          ) : (
            <>
              {field("Amount (₹) *", "amount", {
                keyboardType: "decimal-pad",
                placeholder: "0",
                style: [
                  s.input,
                  {
                    backgroundColor: colors.pale,
                    color: colors.green,
                    fontSize: 32,
                    fontWeight: "800",
                    textAlign: "center",
                    height: 80,
                  },
                ],
              })}
              {field("Date (YYYY-MM-DD) *", "date", {
                placeholder: "2026-10-13",
              })}
              {route.screen === "credit" || entry?.type === "credit" ? (
                field("Due date (optional, YYYY-MM-DD)", "due", {
                  placeholder: "YYYY-MM-DD",
                })
              ) : (
                <>
                  <Title>Payment Method</Title>
                  <Chips
                    items={["Cash", "UPI", "Bank", "Other"]}
                    value={form.method}
                    onChange={(v) => f("method", v)}
                  />
                </>
              )}
              {field("Description / Note", "note", {
                placeholder: route.screen === "credit"
                  ? "Grocery Items"
                  : route.screen === "refund"
                    ? "Advance refund"
                    : "Received payment",
                multiline: true,
              })}
              <Button
                title={
                  route.screen === "editTransaction"
                    ? "Save Changes"
                    : route.screen === "credit"
                      ? "Save Udhari"
                      : route.screen === "refund"
                        ? "Refund Advance"
                        : "Save Payment"
                }
                disabled={busy}
                onPress={saveEntry}
              />
              {route.screen === "editTransaction" && entry && (
                <Button
                  title="Delete Transaction"
                  danger
                  onPress={() => deleteEntry(entry)}
                />
              )}
            </>
          )}
        </>
      );
      break;
    case "transaction":
      if (entry) {
        content = (
          <>
            <Card style={{ alignItems: "center", paddingVertical: 30 }}>
              <Text style={s.amount}>{money(entry.amount)}</Text>
              <View style={s.badge}>
                <Text style={{ color: colors.green, fontWeight: "700" }}>
                  {entryLabel(entry.type).toUpperCase()}
                </Text>
              </View>
              <Title>
                {data.customers.find((c) => c.id === entry.customerId)?.name}
              </Title>
              <Hint>{entry.date}</Hint>
            </Card>
            <Title>Description</Title>
            <Text style={s.rowTitle}>{entry.note || "No description"}</Text>
            {entry.type !== "credit" && (
              <Row title="Payment Method" value={entry.method} />
            )}
            {entry.reference ? <Row title="Reference" value={entry.reference} /> : null}
            {entry.type === "payment" && entry.appliedToUdhari !== undefined && (
              <>
                <Row title="Adjusted Against Udhari" value={money(entry.appliedToUdhari)} />
                <Row title="Added to Advance" value={money(entry.addedToAdvance || 0)} />
              </>
            )}
            {entry.type === "credit" && (entry.advanceApplied || 0) > 0 && (
              <Row title="Adjusted From Advance" value={money(entry.advanceApplied || 0)} />
            )}
            {entry.due && <Row title="Due Date" value={entry.due} />}
            <Button
              title="Edit"
              onPress={() => go("editTransaction", entry.id)}
            />
            <Button title="Delete" danger onPress={() => deleteEntry(entry)} />
          </>
        );
      }
      break;
    case "khata":
      content = (
        <>
          {monthPicker()}
          <Field
            label="Search customer"
            value={search}
            onChangeText={setSearch}
            placeholder="Customer name"
          />
          <Chips
            items={["All", "Udhari", "Payment"]}
            value={filter}
            onChange={setFilter}
          />
          {data.customers
            .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
            .filter(
              (c) =>
                filter === "All" ||
                monthly(data, c.id, month)[
                  filter === "Udhari" ? "credit" : "payment"
                ] > 0,
            )
            .map((c) => {
              const m = monthly(data, c.id, month);
              return (
                <Pressable
                  accessibilityRole="button"
                  key={c.id}
                  onPress={() => go("statement", c.id)}
                >
                  <Card>
                    <Title>{c.name}</Title>
                    <Row title="Opening Balance" value={money(m.opening)} />
                    <Row title="Udhari" value={money(m.credit)} />
                    <Row title="Payment" value={money(m.payment)} />
                    {m.refund > 0 && <Row title="Advance Refund" value={money(m.refund)} />}
                    <Row
                      title="Closing Balance"
                      value={money(m.closing)}
                      color={colors.green}
                    />
                  </Card>
                </Pressable>
              );
            })}
          {!data.customers.length && (
            <Empty
              title="Your monthly khata"
              description="Customer balances will appear here after you add customers."
            />
          )}
        </>
      );
      break;
    case "statement":
      if (customer) {
        const m = monthly(data, customer.id, month);
        content = (
          <>
            {monthPicker(
              customer.createdAt ? monthForDate(customer.createdAt) : undefined,
              today().slice(0, 7),
            )}
            <Card>
              <Title>{data.shop.name}</Title>
              <Hint>{data.shop.address}</Hint>
              <Text style={s.rowTitle}>{customer.name}</Text>
              <Row title="Opening Balance" value={money(m.opening)} />
              {m.entries.map((e) => (
                <Row
                  key={e.id}
                  title={e.note || entryLabel(e.type)}
                  subtitle={e.date}
                  value={`${entrySign(e.type)}${money(e.amount)}`}
                  onPress={() => go("transaction", e.id)}
                />
              ))}
              <Row title="Total Udhari" value={money(m.credit)} />
              <Row title="Total Payment" value={money(m.payment)} />
              {m.refund > 0 && <Row title="Advance Refund" value={money(m.refund)} />}
              <Hint>Outstanding</Hint>
              <Text style={s.amount}>{money(m.closing)}</Text>
            </Card>
            <Button
              title="WhatsApp / SMS Share"
              onPress={() => go("share", customer.id)}
            />
            <Button
              title="Share Statement"
              secondary
              onPress={() => {
                Share.share({ message: statementText(customer.id) }).catch(() =>
                  Alert.alert("Unable to share", "Please try again."),
                );
              }}
            />
          </>
        );
      }
      break;
    case "share":
      if (customer)
        content = (
          <>
            <Title>
              {customer.name} • {monthLabel(month)}
            </Title>
            <Card style={{ backgroundColor: colors.pale }}>
              <Hint>Outstanding</Hint>
              <Text style={s.amount}>
                {money(monthly(data, customer.id, month).closing)}
              </Text>
            </Card>
            <Title>Send Via</Title>
            <Chips
              items={["WhatsApp", "SMS"]}
              value={channel}
              onChange={setChannel}
            />
            {field("Message Preview", "message", {
              multiline: true,
              style: [s.input, { height: 240, textAlignVertical: "top" }],
            })}
            <Button title={`Open ${channel}`} onPress={sendStatement} />
            <Hint>You can review and send the message in {channel}.</Hint>
          </>
        );
      break;
    case "notifications":
      content = (
        <>
          <Hint>Account updates and delivery activity</Hint>
          {notices.map((notice) => (
            <Card key={notice.id} style={{ backgroundColor: notice.read ? "white" : colors.pale }}>
              <Row title={notice.title} subtitle={`${notice.body}\n${new Date(notice.date).toLocaleString("en-IN")}`} value={notice.read ? "Read" : "New"} onPress={() => {
                if (notice.read) return;
                api.markNotificationsRead([notice.id]).then(() => setNotices(old => old.map(n => n.id === notice.id ? { ...n, read: true } : n))).catch(error => Alert.alert("Unable to update", errorMessage(error, "Please try again.")));
              }} />
            </Card>
          ))}
          <Hint>Recent activity</Hint>
          {data.audit.length === 0 && (
            <Empty
              title="You’re all caught up"
              description="New customers and transaction confirmations appear here."
            />
          )}
          {data.audit.slice(0, 30).map((a) => (
            <Card
              key={a.id}
              style={{
                backgroundColor: data.read.includes(a.id)
                  ? "white"
                  : colors.pale,
              }}
            >
              <Row
                title={a.action}
                subtitle={new Date(a.date).toLocaleString("en-IN")}
                value={data.read.includes(a.id) ? "Read" : "New"}
                onPress={() => {
                  commit({ ...data, read: [...new Set([...data.read, a.id])] });
                }}
              />
            </Card>
          ))}
          {outstanding > 0 && (
            <Row
              title="Monthly statements available"
              subtitle="Review pending balances in Khata"
              onPress={() => go("khata")}
            />
          )}
        </>
      );
      break;
    case "reports": {
      const trend = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(`${month}-01T12:00:00`);
        d.setMonth(d.getMonth() - 5 + i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        return {
          label: d.toLocaleDateString("en-IN", { month: "short" }),
          value: periodUdhari(data, key),
        };
      });
      const max = Math.max(...trend.map((t) => t.value), 1);
      content = (
        <>
          {monthPicker()}
          <View style={s.split}>
            {stat("Monthly Udhari", money(totalCredit), true)}
            {stat("Collection", money(totalPayment))}
          </View>
          <View style={s.split}>
            {stat("Outstanding (all time)", money(outstanding))}
            {stat(
              "Active customers",
              String(new Set(monthEntries.map((e) => e.customerId)).size),
            )}
          </View>
          <Card>
            <Title>6-Month Udhari Trend</Title>
            <View
              style={{
                height: 180,
                flexDirection: "row",
                gap: 12,
                alignItems: "flex-end",
                paddingTop: 20,
              }}
            >
              {trend.map((t, i) => (
                <View key={i} style={{ flex: 1, alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 9, color: colors.muted }}>
                    {money(t.value)}
                  </Text>
                  <View
                    style={{
                      height: Math.max(3, (t.value / max) * 115),
                      backgroundColor: colors.green,
                      width: "75%",
                      borderTopLeftRadius: 5,
                      borderTopRightRadius: 5,
                    }}
                  />
                  <Text style={s.small}>{t.label}</Text>
                </View>
              ))}
            </View>
          </Card>
          <Card>
            <Title>Customer Balance Distribution</Title>
            <Row
              title="Paid / Credit balance"
              value={String(
                data.customers.filter((c) => balance(data, c.id) <= 0).length,
              )}
            />
            <Row
              title="Pending"
              value={String(
                data.customers.filter(
                  (c) => balance(data, c.id) > 0 && !isOverdue(c),
                ).length,
              )}
            />
            <Row
              title="Overdue"
              value={String(data.customers.filter(isOverdue).length)}
            />
          </Card>
        </>
      );
      break;
    }
    case "more":
      content = (
        <>
          <Card style={{ backgroundColor: colors.pale }}>
            <Icon name="storefront-outline" size={32} />
            <Title>{data.shop.name}</Title>
            <Hint>{data.shop.owner}</Hint>
          </Card>
          {(
            [
              "profile",
              "reports",
              "notifications",
              "settings",
              "help",
              "subscription",
              "audit",
              "account",
            ] as Screen[]
          ).map((screen) => (
            <Row
              key={screen}
              title={titles[screen] || screen}
              onPress={() => go(screen)}
            />
          ))}
          <Hint>Digital Khata 1.0 • Local demo</Hint>
        </>
      );
      break;
    case "profile":
      content = (
        <>
          <View style={s.logo}>
            <Text style={{ color: "white", fontSize: 40, fontWeight: "800" }}>
              {data.shop.name[0]}
            </Text>
          </View>
          <Text style={[s.heading, { textAlign: "center" }]}>
            {data.shop.name}
          </Text>
          <Row title="Owner" value={data.shop.owner} />
          <Row title="Phone" value={data.shop.phone} />
          <Row title="WhatsApp" value={data.shop.whatsapp || "Not added"} />
          <Row title="Address" value={data.shop.address || "Not added"} />
          <Button title="Edit Profile" onPress={() => go("setup")} />
        </>
      );
      break;
    case "settings":
      content = (
        <>
          <Title>NETWORK</Title>
          <Hint>
            {connectivityStatus === "online"
              ? "Online — Digital-Khata server is reachable."
              : connectivityStatus === "offline"
                ? "Offline — no active network connection."
                : connectivityStatus === "server_unavailable"
                  ? "Server unavailable — network connected, but Digital-Khata cannot be reached."
                  : "Checking network and Digital-Khata server…"}
          </Hint>
          {connectivityStatus !== "checking" && (
            <Hint>
              {`Network: ${currentConnectivityDetails().networkType}; internet: ${currentConnectivityDetails().internetReachable === null ? "unknown" : currentConnectivityDetails().internetReachable ? "available" : "unavailable"}; API: ${currentConnectivityDetails().backendReachable ? "reachable" : currentConnectivityDetails().backendReachable === false ? "unreachable" : "not checked"}.`}
            </Hint>
          )}
          <Title>SYNC STATUS</Title>
          {!syncStatus ? (
            <Hint>Sync status is unavailable in this app build.</Hint>
          ) : syncStatus.failed ? (
            <Hint>
              {syncStatus.failed} saved change{syncStatus.failed === 1 ? "" : "s"} failed to sync. They remain on this phone and will not retry automatically.
            </Hint>
          ) : null}
          {!!syncStatus?.conflicts && (
            <Hint>
              {syncStatus.conflicts} transaction conflict{syncStatus.conflicts === 1 ? " needs" : "s need"} your decision. Both versions remain saved.
            </Hint>
          )}
          {!!syncStatus?.mobileConflicts && (
            <Hint>
              {syncStatus.mobileConflicts} customer change{syncStatus.mobileConflicts === 1 ? " uses" : "s use"} a mobile number already assigned in this shop. The local customer and its ledger remain saved; no records were merged. Change the number on the local customer, then retry synchronization.
            </Hint>
          )}
          {!!syncStatus?.pending && (
            <Hint>
              {syncStatus.pending} saved change{syncStatus.pending === 1 ? " is" : "s are"} waiting to sync.
            </Hint>
          )}
          {syncStatus &&
            !syncStatus.pending &&
            !syncStatus.failed &&
            !syncStatus.conflicts && (
            <Hint>All saved changes are synchronized.</Hint>
          )}
          {!!syncStatus?.failed && (
            <Button
              title="Retry failed sync"
              onPress={() => void retryFailedSync()}
              disabled={busy}
            />
          )}
          <Title>ACCOUNT</Title>
          <Row title="Mobile Number" value={data.shop.phone} />
          <Row
            title="Change PIN"
            onPress={() =>
              Alert.alert(
                "PIN not available",
                "Mobile sign-in uses secure OTP verification. PIN setup is not available yet.",
              )
            }
          />
          <Row title="Logout / Account actions" onPress={() => go("account")} />
          <Hint>
            Sign-in and account data are connected to the Digital Khata server.
          </Hint>
          <Title>KHATA</Title>
          <Row title="Reminder Settings" onPress={() => go("reminders")} />
          <Title>Default payment method</Title>
          <Chips
            items={["Cash", "UPI", "Bank", "Other"]}
            value={data.defaultMethod}
            onChange={(v) => commit({ ...data, defaultMethod: v })}
          />
          <Title>DATA</Title>
          <Row title="Export data (CSV)" onPress={() => exportData(false)} />
          <Row title="Save backup (JSON)" onPress={() => exportData(true)} />
          <Row title="Restore backup" onPress={restore} />
          <Title>LANGUAGE</Title>
          <Chips
            items={["English", "हिन्दी"]}
            value={data.language}
            onChange={(language) => commit({ ...data, language })}
          />
          <Hint>Your account data syncs with the server. Export backups regularly.</Hint>
        </>
      );
      break;
    case "reminders": {
      const r = data.reminders;
      const update = (key: string, value: string | boolean) =>
        commit({
          ...dataRef.current,
          reminders: { ...dataRef.current.reminders, [key]: value },
        });
      content = (
        <>
          <Hint>Preferences sync to your account. Automatic delivery requires configured messaging providers; manual sharing remains available from Khata.</Hint>
          <Toggle
            label="Monthly Reminder"
            value={r.enabled}
            onChange={(v) => update("enabled", v)}
          />
          <Title>Reminder Date</Title>
          <Chips
            items={["1", "15", "Last day"]}
            value={r.day}
            onChange={(v) => update("day", v)}
          />
          <Field
            label="Reminder Time (HH:MM)"
            value={r.time}
            onChangeText={(v) => update("time", v)}
            onEndEditing={() => {
              if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) {
                update("time", "10:00");
                Alert.alert(
                  "Invalid time",
                  "Use 24-hour HH:MM format. Reset to 10:00.",
                );
              }
            }}
          />
          <Field
            label="Minimum Outstanding (₹)"
            keyboardType="decimal-pad"
            value={r.minimum}
            onChangeText={(v) => update("minimum", v)}
            onEndEditing={() => {
              if (!Number.isFinite(Number(r.minimum)) || Number(r.minimum) < 0)
                update("minimum", "100");
            }}
          />
          <Toggle
            label="WhatsApp"
            value={r.whatsapp}
            onChange={(v) => update("whatsapp", v)}
          />
          <Toggle
            label="SMS"
            value={r.sms}
            onChange={(v) => update("sms", v)}
          />
        </>
      );
      break;
    }
    case "help": {
      const faqs = [
        [
          "How do I add a customer?",
          "Open Customers, tap Add Customer, enter their name and optional details, then Save Customer.",
        ],
        [
          "How do I record payment?",
          "Open a customer, tap Payment, enter the amount, date and method, then Save Payment.",
        ],
        [
          "How is balance calculated?",
          "Outstanding = opening outstanding + udhari − payments. A negative balance means the customer has paid in advance.",
        ],
        [
          "How do I send WhatsApp reminders?",
          "Open Khata, select a customer and month, then WhatsApp / SMS Share. Add the customer’s phone number and enable their reminders first.",
        ],
        [
          "How do I keep my data safe?",
          "Use Settings → Save backup to export a JSON copy. Restore it through Settings → Restore backup. This version has no cloud sync.",
        ],
      ];
      content = (
        <>
          <Field
            label="Search Help"
            placeholder="Search common questions"
            value={search}
            onChangeText={setSearch}
          />
          <Title>Common Questions</Title>
          {faqs
            .filter(([q, a]) =>
              (q + a).toLowerCase().includes(search.toLowerCase()),
            )
            .map(([q, a]) => (
              <Card key={q}>
                <Row title={q} onPress={() => setFaq(faq === q ? "" : q)} />
                {faq === q && <Hint>{a}</Hint>}
              </Card>
            ))}
          <Hint>
            WhatsApp and call support are not configured. Add your business
            support contact before production release.
          </Hint>
          <Button
            title="WhatsApp Support"
            onPress={() =>
              Alert.alert(
                "Support not configured",
                "Add your business WhatsApp support number before release.",
              )
            }
          />
          <Button
            title="Call Support"
            secondary
            onPress={() =>
              Alert.alert(
                "Support not configured",
                "Add your business support phone number before release.",
              )
            }
          />
        </>
      );
      break;
    }
    case "subscription": {
      const current = subscriptionSnapshot?.current;
      const plans = subscriptionSnapshot?.plans || [];
      const selected = plans.find((item) => item.name === plan || item.code === plan.toLowerCase());
      const duration = Number(subscriptionDuration);
      const price = selected?.durations.find((item) => item.months === duration);
      const asRupees = (minor?: number | null) => money((minor || 0) / 100);
      const remainingText = current?.expiresAt
        ? current.remainingMilliseconds !== null && current.remainingMilliseconds < 86400000
          ? `${Math.max(0, Math.floor(current.remainingMilliseconds / 3600000))} hours ${Math.max(0, Math.floor((current.remainingMilliseconds % 3600000) / 60000))} minutes remaining`
          : `${current.remainingDays ?? 0} days remaining`
        : "Never expires";
      content = (
        <>
          {current && (
            <Card>
              <Title>Current Subscription</Title>
              <Row title="Plan" value={current.plan.name} />
              <Row title="Status" value="Active" />
              <Row title="Start date" value={current.startsAt ? new Date(current.startsAt).toLocaleDateString("en-IN") : "—"} />
              <Row title="Expiry" value={current.expiresAt ? new Date(current.expiresAt).toLocaleDateString("en-IN") : "Never"} />
              <Row title="Time remaining" value={remainingText} />
              <Row title="Customer limit" value={current.customerUsage.unlimited ? "Unlimited" : String(current.customerUsage.limit ?? 0)} />
              <Row title="Customers used" value={String(current.customerUsage.used)} />
              {!current.customerUsage.unlimited && <Row title="Customer capacity left" value={String(current.customerUsage.remaining ?? 0)} />}
              {current.durationMonths > 0 && <Row title="Duration" value={`${current.durationMonths} months`} />}
              {current.amountPaidMinor !== null && <Row title="Amount paid" value={asRupees(current.amountPaidMinor)} />}
              {current.scheduled && (
                <>
                  <Title>Next Scheduled Plan</Title>
                  <Row title="Plan" value={current.scheduled.plan.name} />
                  <Row title="Starts" value={new Date(current.scheduled.startsAt).toLocaleDateString("en-IN")} />
                  <Row title="Activation" value={`Starts in ${Math.max(0, Math.ceil((new Date(current.scheduled.startsAt).getTime() - Date.now()) / 86400000))} days`} />
                  <Row title="Duration" value={`${current.scheduled.durationMonths} months`} />
                </>
              )}
              {current.isFallback && <Hint>Free plan • ₹0 • 50 customers • Expiry: Never</Hint>}
            </Card>
          )}
          {(subscriptionSnapshot?.history || []).length > 0 && (
            <>
              <Title>Subscription History</Title>
              {subscriptionSnapshot!.history.map((item) => {
                const timeRemaining = item.remainingMilliseconds;
                const remaining = timeRemaining !== null && timeRemaining < 86400000
                  ? `${Math.floor(timeRemaining / 3600000)} hours ${Math.floor((timeRemaining % 3600000) / 60000)} minutes remaining`
                  : `${item.remainingDays ?? 0} days remaining`;
                const startsIn = item.startsInDays !== null
                  ? `Starts in ${item.startsInDays} days`
                  : null;
                return (
                  <Card key={item.id}>
                    <Title>{item.plan?.name || item.plan?.code || "Subscription"}</Title>
                    <Row title="Status" value={item.status} />
                    {item.startsAt && <Row title="Starts" value={new Date(item.startsAt).toLocaleDateString("en-IN")} />}
                    {item.expiresAt && <Row title="Expires" value={new Date(item.expiresAt).toLocaleDateString("en-IN")} />}
                    {item.status === "active" && item.remainingMilliseconds !== null && <Row title="Time remaining" value={remaining} />}
                    {startsIn && <Row title="Activation" value={startsIn} />}
                    <Row title="Duration" value={`${item.durationMonths} months`} />
                    {item.amountPaidMinor !== null && <Row title="Amount paid" value={asRupees(item.amountPaidMinor)} />}
                  </Card>
                );
              })}
            </>
          )}
          {subscriptionLoading && <ActivityIndicator color={colors.green} />}
          {!subscriptionSnapshot && !subscriptionLoading && (
            <Card>
              <Hint>{subscriptionLoadError || "Subscription information is loading."}</Hint>
              <Button title="Retry" secondary onPress={() => void refreshSubscriptionInfo()} />
            </Card>
          )}
          <Title>Choose Your Plan</Title>
          {plans.map((item) => (
            <Pressable key={item.code} onPress={() => { setPlan(item.name); setSubscriptionDuration("1"); }}>
              <Card style={{ borderColor: plan === item.name || plan.toLowerCase() === item.code ? colors.green : colors.border, borderWidth: plan === item.name || plan.toLowerCase() === item.code ? 2 : 1 }}>
                <View style={s.split}>
                  <Text style={[s.heading, { fontSize: 20 }]}>{item.name}</Text>
                  <Text style={s.stat}>{asRupees(item.monthlyPriceMinor)}{item.monthlyPriceMinor ? "/mo" : ""}</Text>
                </View>
                <Hint>{item.unlimitedCustomers ? "Unlimited customers" : `${item.customerLimit} customers`}</Hint>
              </Card>
            </Pressable>
          ))}
          {selected && selected.code !== "free" && (
            <Card>
              <Title>Subscription duration</Title>
              <Chips items={selected.durations.map((item) => `${item.months} months`)} value={`${duration} months`} onChange={(value) => setSubscriptionDuration(value.split(" ")[0])} />
              {price && (
                <>
                  {price.discountPercent > 0 && <Hint>Save {price.discountPercent}% for {price.months} months</Hint>}
                  <Row title="Original amount" value={asRupees(price.originalAmountMinor)} />
                  <Row title={`Discount (${price.discountPercent}%)`} value={`−${asRupees(price.discountAmountMinor)}`} />
                  <Row title={`Tax (${(price.taxRateBps / 100).toFixed(2)}%)${price.taxInclusive ? " included" : ""}`} value={asRupees(price.taxAmountMinor)} />
                  <Row title="Final payable" value={asRupees(price.finalAmountMinor)} />
                </>
              )}
            </Card>
          )}
          <Button
            title="Payment checkout unavailable in this build"
            disabled
            onPress={() => Alert.alert("Payments unavailable", "Checkout is disabled until Android billing eligibility and a supported native payment integration are confirmed.")}
          />
          <Button title="Payment History" secondary onPress={() => go("subscriptionPayments")} />
          <Hint>
            {subscriptionSnapshot?.cachedAt
              ? `Last synchronized ${new Date(subscriptionSnapshot.cachedAt).toLocaleString("en-IN")}. ${subscriptionSnapshot.notificationsGranted === false ? "Enable notifications to receive local renewal reminders." : "Renewal reminders are scheduled when permission is available."} Checkout remains disabled until Android billing eligibility and a supported native payment integration are confirmed.`
              : "Subscription information is server-verified and cached securely for offline viewing. Payment confirmation requires an internet connection. Checkout is disabled until Android billing eligibility and a supported native payment integration are confirmed."}
          </Hint>
          {subscriptionLoadError ? <Hint>{subscriptionLoadError}</Hint> : null}
        </>
      );
      break;
    }
    case "subscriptionPayments":
      content = (
        <>
          <Hint>
            {subscriptionSnapshot?.cachedAt
              ? `Cached history • Last synchronized ${new Date(subscriptionSnapshot.cachedAt).toLocaleString("en-IN")}`
              : "Payment history is unavailable offline until it has been synchronized."}
          </Hint>
          {(subscriptionSnapshot?.payments || []).length === 0 && !subscriptionLoading ? (
            <Empty title="No payments yet" description="Verified subscription payments will appear here." />
          ) : null}
          {(subscriptionSnapshot?.payments || []).map((payment: any) => (
            <Card key={payment.id}>
              <Title>{String(payment.planCode || "").toUpperCase()} • {payment.durationMonths} months</Title>
              <Row title="Original amount" value={money((payment.pricing?.originalAmountMinor || 0) / 100)} />
              <Row title="Discount" value={money((payment.pricing?.discountAmountMinor || 0) / 100)} />
              <Row title="Tax" value={money((payment.pricing?.taxAmountMinor || 0) / 100)} />
              <Row title="Amount paid" value={money((payment.amountMinor || 0) / 100)} />
              <Row title="Date" value={new Date(payment.createdAt).toLocaleString("en-IN")} />
              <Row title="Status" value={payment.status} />
              {payment.gatewayPaymentId && <Row title="Payment reference" value={payment.gatewayPaymentId} />}
              {payment.gatewayOrderId && <Row title="Order reference" value={payment.gatewayOrderId} />}
              {payment.method && <Row title="Payment method" value={payment.method} />}
              {payment.currency && <Row title="Currency" value={payment.currency} />}
              {payment.refunded && <Row title="Refund status" value={`${payment.status} • ${money((payment.refundedAmountMinor || 0) / 100)} refunded`} />}
              <Hint>Tax invoice availability depends on the merchant's configured invoicing service.</Hint>
            </Card>
          ))}
          {subscriptionSnapshot?.paymentsNextCursor ? (
            <Button
              title={subscriptionPageLoading ? "Loading…" : "Load more payments"}
              secondary
              disabled={subscriptionPageLoading}
              onPress={() => void loadMoreSubscriptionPayments()}
            />
          ) : null}
          {subscriptionLoadError ? <Hint>{subscriptionLoadError}</Hint> : null}
          {subscriptionLoading && <ActivityIndicator color={colors.green} />}
          <Button title="Refresh" secondary onPress={() => void refreshSubscriptionInfo()} />
        </>
      );
      break;
    case "account":
      content = (
        <>
          <Card>
            <Title>Are you sure you want to logout?</Title>
            <Hint>Your khata is securely stored with your account and available after you log in again.</Hint>
            <Button
              title="Cancel"
              secondary
              onPress={() => go("home", undefined, true)}
            />
            <Button
              title="Logout"
              onPress={() =>
                save({ ...data, signedIn: false }, () => {
                  setPhone("");
                  setOtp("");
                  go("welcome", undefined, true);
                })
              }
            />
          </Card>
          <Title>Delete account</Title>
          <Hint>
            This permanently removes your shop, customers, transactions, and activity history from the server. Export a backup first.
          </Hint>
          <Field
            label="Type DELETE to confirm"
            value={form.confirm || ""}
            onChangeText={(v) => f("confirm", v)}
            autoCapitalize="characters"
          />
          <Button
            title="Delete account"
            danger
            disabled={form.confirm !== "DELETE" || busy}
            onPress={() =>
              Alert.alert(
                "Permanently delete your account data?",
                "This cannot be undone. Exported backups will not be deleted.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete permanently",
                    style: "destructive",
                    onPress: deleteLocalAccount,
                  },
                ],
              )
            }
          />
        </>
      );
      break;
    case "audit":
      content = (
        <>
          <Hint>
            Server-recorded customer and transaction activity for this shop.
          </Hint>
          {data.audit.map((a) => (
            <Card key={a.id}>
              <Title>{a.action}</Title>
              <Hint>{new Date(a.date).toLocaleString("en-IN")}</Hint>
              {a.before && (
                <Hint>
                  Before: {money(a.before.amount)} • {a.before.date} •{" "}
                  {a.before.note}
                </Hint>
              )}
              {a.after && (
                <Hint>
                  After: {money(a.after.amount)} • {a.after.date} •{" "}
                  {a.after.note}
                </Hint>
              )}
              {a.resolution && (
                <>
                  <Hint>Customer: {a.resolution.customerName} • Transaction: {a.resolution.transactionId}</Hint>
                  <Hint>
                    Phone: {money(a.resolution.offlineAmount)} • Previous server: {money(a.resolution.previousServerAmount)} • Final: {a.resolution.finalAmount === null ? "Deleted" : money(a.resolution.finalAmount)}
                  </Hint>
                  <Hint>{a.resolution.decision} • Resolved by: {a.resolution.resolvedBy}</Hint>
                </>
              )}
            </Card>
          ))}
          {!data.audit.length && (
            <Empty
              title="No activity yet"
              description="Changes you make to this khata will appear here."
            />
          )}
        </>
      );
      break;
  }
  if (loadError)
    return (
      <SafeAreaView
        style={[s.container, { padding: 24, justifyContent: "center" }]}
      >
        <Title>Your khata could not be opened safely</Title>
        <Hint>
          Check the API connection and try again. Your last server data remains unchanged.
        </Hint>
      </SafeAreaView>
    );
  if (!loaded)
    return (
      <SafeAreaView
        style={[
          s.container,
          { justifyContent: "center", alignItems: "center", gap: 20 },
        ]}
      >
        <View style={s.logo}>
          <Text style={{ color: "white", fontSize: 48 }}>₹</Text>
        </View>
        <Text style={s.hero}>Digital Khata</Text>
        <Hint>Udhari ka hisaab, ab aur bhi aasan</Hint>
        <ActivityIndicator color={colors.green} />
      </SafeAreaView>
    );
  const tabs: {
    screen: Screen;
    label: string;
    icon: React.ComponentProps<typeof Icon>["name"];
  }[] = [
    { screen: "home", label: "Home", icon: "home-outline" },
    { screen: "customers", label: "Customers", icon: "people-outline" },
    { screen: "credit", label: "Add", icon: "add" },
    { screen: "khata", label: "Khata", icon: "book-outline" },
    { screen: "more", label: "More", icon: "ellipsis-horizontal" },
  ];
  const showNav =
    data.signedIn &&
    !["setup", "welcome", "login", "otp"].includes(route.screen);
  return (
    <LanguageContext.Provider value={data.language}>
      <SafeAreaView style={s.container} edges={["top", "bottom"]}>
        <StatusBar style="dark" />
        {route.screen !== "welcome" && route.screen !== "home" && (
          <View style={s.header}>
            {(history.length > 0 ||
              !tabs.some((t) => t.screen === route.screen)) && (
              <Pressable
                accessibilityLabel="Go back"
                onPress={back}
                style={{ padding: 3 }}
              >
                <Icon name="chevron-back" color={colors.dark} />
              </Pressable>
            )}
            <Text style={s.heading}>
              {route.screen === "customer"
                ? customer?.name
                : route.screen === "customerForm" && route.id
                  ? "Edit Customer"
                  : titles[route.screen]}
            </Text>
          </View>
        )}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            key={`${route.screen}-${route.id || ""}`}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.content}
          >
            {content}
          </ScrollView>
        </KeyboardAvoidingView>
        {showNav && (
          <View style={s.nav}>
            {tabs.map((t) => (
              <Pressable
                key={t.screen}
                accessibilityRole="button"
                accessibilityLabel={t.label}
                onPress={() => go(t.screen, undefined, true)}
                style={s.navItem}
              >
                <View style={t.label === "Add" ? s.add : undefined}>
                  <Icon
                    name={t.icon}
                    color={
                      t.label === "Add"
                        ? "white"
                        : route.screen === t.screen
                          ? colors.green
                          : colors.muted
                    }
                    size={t.label === "Add" ? 28 : 23}
                  />
                </View>
                <Text
                  style={[
                    s.navLabel,
                    route.screen === t.screen && {
                      color: colors.green,
                      fontWeight: "700",
                    },
                  ]}
                >
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <Modal
          visible={networkDiagnosticsVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setNetworkDiagnosticsVisible(false)}
        >
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              padding: 20,
              backgroundColor: "rgba(0,0,0,0.42)",
            }}
          >
            <Card style={{ maxHeight: "86%" }}>
              <Text style={s.heading}>Network Diagnostics</Text>
              <ScrollView
                style={{ marginVertical: 10 }}
                keyboardShouldPersistTaps="handled"
              >
                <Hint>{`App mode: ${networkBuildInfo.appMode}`}</Hint>
                <Hint>{`Build profile: ${networkBuildInfo.buildProfile}`}</Hint>
                <Hint>{`Configured API base URL: ${networkDiagnostics.apiBaseUrl || "Unavailable"}`}</Hint>
                <Hint>{`Health-check URL: ${networkDiagnostics.healthUrl || "Unavailable"}`}</Hint>
                <Hint>{`Network type: ${networkDiagnostics.networkType}`}</Hint>
                <Hint>{`Device network connection: ${networkDiagnostics.networkConnected === null ? "Unknown" : networkDiagnostics.networkConnected ? "Connected" : "Disconnected"}`}</Hint>
                <Hint>{`Backend reachability: ${connectivityStatus === "online" ? "Reachable" : connectivityStatus === "offline" ? "Not checked (offline)" : connectivityStatus === "server_unavailable" ? "Unavailable or unhealthy" : "Checking"}`}</Hint>
                <Hint>{`Offline encrypted database: ${offlineStorageReadiness()}`}</Hint>
                <Hint>{`SQLite initialization stage: ${storageDiagnostics.stage}`}</Hint>
                <Hint>{`Native SQLite available: ${storageDiagnostics.nativeSQLiteAvailable ? "Yes" : "No / not initialized"}`}</Hint>
                <Hint>{`SQLCipher supported: ${storageDiagnostics.sqlCipherSupported === null ? "Not checked" : storageDiagnostics.sqlCipherSupported ? "Yes" : "No"}`}</Hint>
                <Hint>{`SecureStore key exists: ${storageDiagnostics.secureKeyExists === null ? "Not checked" : storageDiagnostics.secureKeyExists ? "Yes" : "No"}`}</Hint>
                <Hint>{`SecureStore key retrieval: ${storageDiagnostics.secureKeyReadSucceeded === null ? "Not checked" : storageDiagnostics.secureKeyReadSucceeded ? "Succeeded" : "Failed"}`}</Hint>
                <Hint>{`Database open: ${storageDiagnostics.databaseOpenSucceeded === null ? "Not checked" : storageDiagnostics.databaseOpenSucceeded ? "Succeeded" : "Failed"}`}</Hint>
                <Hint>{`Encryption verification: ${storageDiagnostics.encryptionVerified === null ? "Not checked" : storageDiagnostics.encryptionVerified ? "Succeeded" : "Failed"}`}</Hint>
                <Hint>{`Migration: ${storageDiagnostics.migrationSucceeded === null ? "Not checked" : storageDiagnostics.migrationSucceeded ? "Succeeded" : "Failed"}`}</Hint>
                <Hint>{`Storage error category: ${storageDiagnostics.errorCategory}`}</Hint>
                {!!storageDiagnostics.errorMessage && <Hint>{`Storage detail: ${storageDiagnostics.errorMessage}`}</Hint>}
                <Hint>{`Offline database ready: ${storageDiagnostics.readiness === "ready" ? "Yes" : "No"}`}</Hint>
                <Hint>{`Offline authorization: ${offlineAccountRef.current && data.signedIn ? "Active for this shop (30-day policy)" : "Not active"}`}</Hint>
                <Hint>{`Sync queue: ${syncStatus ? `${syncStatus.pending} pending, ${syncStatus.failed} failed, ${syncStatus.conflicts} conflicted` : "Unavailable or not initialized"}`}</Hint>
                <Hint>{`Last health-check HTTP status: ${networkDiagnostics.healthHttpStatus ?? "Not received"}`}</Hint>
                <Hint>{`Last API response: ${networkDiagnostics.lastApiResponseStatus === null ? "None" : `HTTP ${networkDiagnostics.lastApiResponseStatus}`}${networkDiagnostics.lastApiResponseAt ? ` at ${new Date(networkDiagnostics.lastApiResponseAt).toLocaleString()}` : ""}`}</Hint>
                <Hint>{`Last request duration: ${networkDiagnostics.healthDurationMs === null ? "Not available" : `${networkDiagnostics.healthDurationMs} ms`}`}</Hint>
                <Hint>{`Last network error category: ${networkDiagnostics.healthErrorCategory || "None"}`}</Hint>
                {!!networkDiagnostics.healthErrorDetail && (
                  <Hint>{`Diagnostic detail: ${networkDiagnostics.healthErrorDetail}`}</Hint>
                )}
                <Hint>{`Last successful connection: ${networkDiagnostics.lastSuccessfulConnectionAt ? new Date(networkDiagnostics.lastSuccessfulConnectionAt).toLocaleString() : "None in this app session"}`}</Hint>
                <Hint>{`Cleartext HTTP: ${networkBuildInfo.cleartextHttpPermitted === null ? "Unknown" : networkBuildInfo.cleartextHttpPermitted ? "Permitted by build configuration" : "Disabled by build configuration"}`}</Hint>
              </ScrollView>
              <Button
                title={networkDiagnosticsRetrying ? "Checking…" : "Retry Connection"}
                disabled={networkDiagnosticsRetrying}
                onPress={() => void retryNetworkDiagnostics()}
              />
              <Button
                title={storageRetrying ? "Retrying storage…" : "Retry Storage Initialization"}
                disabled={storageRetrying || storageDiagnostics.readiness === "ready"}
                onPress={() => void retryStorageInitialization()}
              />
              <Button
                title="Close"
                secondary
                onPress={() => setNetworkDiagnosticsVisible(false)}
              />
            </Card>
          </View>
        </Modal>
      </SafeAreaView>
    </LanguageContext.Provider>
  );
}
export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AppContent />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
