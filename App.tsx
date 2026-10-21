import { formatCurrency, LanguageContext, showLocalizedAlert, t, Text } from "./src/i18n";
import { apiErrorTranslationKey } from "./src/localization";
import { isTemporaryBackendFailure } from "./src/startupRecovery";
import { readLanguagePreference, saveLanguagePreference } from "./src/languagePreference";
import ErrorBoundary from "./src/ErrorBoundary";
import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ActivityIndicator,
  Alert as NativeAlert,
  BackHandler,
  FlatList,
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
  monthly,
  periodReceived,
  periodUdhari,
  today,
  totalUdhari,
  uid,
  validBackup,
} from "./src/model";
import { normalizeCustomerMobile } from "./src/customerPhone";
import { customerLifecycleState, isActiveCustomer, matchesCustomerLifecycleFilter, transitionCustomerLifecycle, type CustomerLifecycleState } from "./src/customerLifecycle";
import { CustomerActionGate } from "./src/customerActionGate";
import { PAGE_SIZE, UserScrollPageGate, nextVisibleCount, visiblePage } from "./src/pagination";
import {
  customerBalanceDisplay,
  formatCustomerCreatedOn,
} from "./src/customerPresentation";
import {
  khataBalanceDisplay,
  khataCustomerMatchesSearch,
  khataEntriesForTab,
  transactionAmountText,
} from "./src/khataPresentation";
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
  saveLocalLanguagePreference,
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
  LanguagePicker,
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
  | "manageCustomers"
  | "customerForm"
  | "customer"
  | "viewCustomer"
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
  error instanceof api.ApiTransportError && error.kind === "network";
const showOtpError = (title: string, error: unknown, fallback: string, language: string) => {
  const unreachable = isOfflineError(error);
  const offline = currentConnectivity() === "offline";
  showLocalizedAlert(
    language,
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
      ? "Sync timed out"
      : currentConnectivity() === "offline"
        ? "You’re offline"
        : "Server unavailable"
    : error instanceof api.ApiError
      ? (() => {
          const code = error.payload?.code;
          return apiErrorTranslationKey(code, error.status);
        })()
      : fallback;
const titles: Partial<Record<Screen, string>> = {
  login: "Login",
  otp: "Verify Mobile",
  setup: "Set Up Your Shop",
  customers: "Customers",
  manageCustomers: "Manage Customers",
  customerForm: "Add Customer",
  viewCustomer: "View Customer",
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

async function scheduleSubscriptionNotifications(
  snapshot: SubscriptionSnapshot,
  accountId: string,
  requestPermission: boolean,
  language: string,
) {
  const Notifications = await loadNotifications();
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("subscription", {
      name: t("Subscription reminders", language),
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
    const remaining = days === 0
      ? t("expires today", language)
      : t("expires in {{days}} days", language, { days });
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: t("Digital-Khata subscription reminder", language),
        body: t("Your {{plan}} plan {{remaining}}. Review renewal options in My Subscription.", language, { plan: snapshot.current.plan.name, remaining }),
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
  const activeLanguageRef = useRef(data.language);
  activeLanguageRef.current = data.language;
  const languagePreferenceRevision = useRef(0);
  const languageChosenRef = useRef(false);
  // Keep existing Alert call sites reactive to the current render's locale.
  const Alert = {
    alert: (...args: Parameters<typeof NativeAlert.alert>) => showLocalizedAlert(activeLanguageRef.current, ...args),
  };
  const money = (amount: number) => formatCurrency(amount, data.language);
  const withDeviceLanguage = (value: Data): Data => languageChosenRef.current
    ? { ...value, language: activeLanguageRef.current }
    : value;
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
  const [manageCustomerFilter, setManageCustomerFilter] = useState("All");
  const customerActionGate = useRef(new CustomerActionGate());
  const [savingCustomers, setSavingCustomers] = useState<Record<string, CustomerLifecycleState>>({});
  const [customerPagePending, startCustomerPageTransition] = useTransition();
  const customerPageRequest = useRef<{ key: string; count: number } | null>(null);
  const [month, setMonth] = useState(today().slice(0, 7));
  const matchingCustomers = useMemo(() => {
    if (route.screen === "customers")
      return data.customers.filter((c) => isActiveCustomer(c) &&
        (c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)) &&
        (filter === "All" || (filter === "Due" && balance(data, c.id) > 0) || (filter === "Paid" && balance(data, c.id) <= 0)),
      );
    if (["credit", "payment", "refund"].includes(route.screen))
      return data.customers.filter((c) => isActiveCustomer(c) && (c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)));
    return [];
  }, [data, route.screen, search, filter]);
  const managedCustomers = useMemo(() => data.customers.filter((c) => {
    const tabMatches = matchesCustomerLifecycleFilter(c, manageCustomerFilter as "All" | "Disabled" | "Removed");
    return tabMatches && (c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search));
  }), [data.customers, search, manageCustomerFilter]);
  const khataRows = useMemo(() => {
    if (route.screen !== "khata") return [];
    return data.customers
      .filter((customer) => khataCustomerMatchesSearch(customer.name, search))
      .flatMap((customer) => {
        const summary = monthly(data, customer.id, month);
        return khataEntriesForTab(summary.entries, filter, month).map((entry) => ({ customer, summary, entry }));
      });
  }, [data, route.screen, search, filter, month]);
  const [listPage, setListPage] = useState({ key: "", count: PAGE_SIZE, loading: false });
  const listPageRef = useRef({ key: "", count: PAGE_SIZE, total: 0, loading: false });
  const listPageCounts = useRef(new Map<string, number>());
  const listScrollOffsets = useRef(new Map<string, number>());
  const restoredListKey = useRef("");
  const virtualListRef = useRef<FlatList<any> | null>(null);
  const listHasScrolled = useRef(false);
  const customerScrollGate = useRef(new UserScrollPageGate());
  const customerScrollStartedForKey = useRef("");
  const customerDragStartOffset = useRef(0);
  const listPageKey = `${route.screen}:${route.id || ""}:${search}:${filter}:${manageCustomerFilter}:${month}`;
  const listPageKeyRef = useRef(listPageKey);
  listPageKeyRef.current = listPageKey;
  const rememberPageCount = (key: string, count: number) => {
    listPageCounts.current.delete(key);
    listPageCounts.current.set(key, count);
    while (listPageCounts.current.size > 32)
      listPageCounts.current.delete(listPageCounts.current.keys().next().value!);
  };
  useEffect(() => {
    // Customer lists begin at page one on every visit. Programmatic restoration of
    // an old scroll offset must not silently restore an expanded customer list.
    const count = route.screen === "customers" || route.screen === "manageCustomers"
      ? PAGE_SIZE
      : listPageCounts.current.get(listPageKey) || PAGE_SIZE;
    listPageRef.current = { key: listPageKey, count, total: 0, loading: false };
    customerPageRequest.current = null;
    listHasScrolled.current = false;
    customerScrollGate.current.reset();
    customerScrollStartedForKey.current = "";
    customerDragStartOffset.current = 0;
    setListPage({ key: listPageKey, count, loading: false });
  }, [listPageKey, route.screen]);
  useEffect(() => {
    if (!customerPagePending) customerPageRequest.current = null;
  }, [customerPagePending, listPage]);
  const pageRecords = <T,>(items: T[]) => {
    const count = listPage.key === listPageKey ? listPage.count : PAGE_SIZE;
    listPageRef.current = {
      key: listPageKey,
      count,
      total: items.length,
      loading: listPage.key === listPageKey && listPage.loading,
    };
    return visiblePage(items, count);
  };
  const listFooter = (hasMore: boolean, loadingLabel = "Loading more...") =>
    hasMore && (
      (route.screen === "manageCustomers" && customerPagePending && customerPageRequest.current?.key === listPageKey) ||
      (listPage.key === listPageKey && listPage.loading) ||
      ((route.screen === "subscription" || route.screen === "subscriptionPayments") && subscriptionPageLoading)
    ) ? (
      <View style={{ paddingVertical: 12, alignItems: "center" }}>
        <ActivityIndicator size="small" color={colors.green} />
        {loadingLabel ? <Hint>{loadingLabel}</Hint> : null}
      </View>
    ) : null;
  const handleListScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    listScrollOffsets.current.set(listPageKeyRef.current, contentOffset.y);
    while (listScrollOffsets.current.size > 32)
      listScrollOffsets.current.delete(listScrollOffsets.current.keys().next().value!);
    if (
      (route.screen === "customers" || route.screen === "manageCustomers") &&
      contentOffset.y > customerDragStartOffset.current + 1
    ) customerScrollGate.current.markUserMovement();
    if (contentOffset.y > 1) listHasScrolled.current = true;
    const current = listPageRef.current;
    const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 180;
    if (listHasScrolled.current && nearBottom && route.screen === "subscription" && subscriptionSnapshot?.historyNextCursor)
      void loadMoreSubscriptionHistory();
    if (listHasScrolled.current && nearBottom && route.screen === "subscriptionPayments" && subscriptionSnapshot?.paymentsNextCursor)
      void loadMoreSubscriptionPayments();
    if (route.screen === "customers" || route.screen === "manageCustomers" || !listHasScrolled.current || !nearBottom || current.key !== listPageKeyRef.current || current.loading || current.count >= current.total) return;
    requestNextVisiblePage();
  };
  const requestNextVisiblePage = () => {
    const current = listPageRef.current;
    if (!listHasScrolled.current || current.key !== listPageKeyRef.current || current.loading || current.count >= current.total) return;
    const nextCount = nextVisibleCount(current.count, current.total);
    if (route.screen === "manageCustomers") {
      if (customerPageRequest.current?.key === current.key) return;
      customerPageRequest.current = { key: current.key, count: nextCount };
      // Keep the current rows visible while React renders the next fifteen.
      // No network request or artificial timer is needed for cached records.
      startCustomerPageTransition(() => {
        setListPage((previous) => listPageKeyRef.current === current.key
          ? { key: current.key, count: nextCount, loading: false }
          : previous);
      });
      return;
    }
    rememberPageCount(current.key, nextCount);
    // Local pagination only reveals already-loaded rows; update atomically instead
    // of delaying the page with a timer just to flash a loading indicator.
    const next = { ...current, count: nextCount, loading: false };
    listPageRef.current = next;
    setListPage({ key: current.key, count: nextCount, loading: false });
  };
  const [form, setForm] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpHint, setOtpHint] = useState<{ key: string; parameters?: Record<string, string | number> } | null>(null);
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
  const subscriptionPageLock = useRef(false);
  const subscriptionHistoryLock = useRef(false);
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
      try {
        const cached = await readSubscriptionSnapshot(accountId);
        if (cached && typeof cached === "object" && "history" in cached && "payments" in cached) {
          const previous = cached as SubscriptionSnapshot;
          snapshot.history = [
            ...snapshot.history,
            ...previous.history.filter((item) => !snapshot.history.some((current) => current.id === item.id)),
          ];
          snapshot.payments = [
            ...snapshot.payments,
            ...previous.payments.filter((item) => !snapshot.payments.some((current) => current.id === item.id)),
          ];
        }
      } catch { /* Retain the fresh server page if the optional cache read fails. */ }
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
          dataRef.current.language,
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
          const reminders = await scheduleSubscriptionNotifications(snapshot, accountId, false, dataRef.current.language);
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
    if (!accountId || !cursor || subscriptionPageLock.current) return;
    subscriptionPageLock.current = true;
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
      const currentPage = listPageRef.current;
      if (currentPage.key === listPageKeyRef.current) {
        const count = Math.min(currentPage.count + PAGE_SIZE, next.payments.length);
        rememberPageCount(currentPage.key, count);
        listPageRef.current = { ...currentPage, count, total: next.payments.length };
        setListPage({ key: currentPage.key, count, loading: false });
      }
    } catch (problem) {
      Alert.alert("Unable to load payment history", errorMessage(problem, "Please try again when you are online."));
    } finally {
      subscriptionPageLock.current = false;
      setSubscriptionPageLoading(false);
    }
  }
  async function loadMoreSubscriptionHistory() {
    const accountId = offlineAccountRef.current;
    const cursor = subscriptionSnapshot?.historyNextCursor;
    if (!accountId || !cursor || subscriptionHistoryLock.current) return;
    subscriptionHistoryLock.current = true;
    setSubscriptionPageLoading(true);
    try {
      const page = await api.getSubscriptionHistory(cursor);
      const next = {
        ...subscriptionSnapshot!,
        history: [
          ...subscriptionSnapshot!.history,
          ...page.items.filter((item) => !subscriptionSnapshot!.history.some((old) => old.id === item.id)),
        ],
        historyNextCursor: page.nextCursor,
      };
      setSubscriptionSnapshot(next);
      if (offlineStorageAvailable()) await cacheSubscriptionSnapshot(accountId, next);
      const currentPage = listPageRef.current;
      if (currentPage.key === listPageKeyRef.current) {
        const count = Math.min(currentPage.count + PAGE_SIZE, next.history.length);
        rememberPageCount(currentPage.key, count);
        listPageRef.current = { ...currentPage, count, total: next.history.length };
        setListPage({ key: currentPage.key, count, loading: false });
      }
    } catch (problem) {
      Alert.alert("Unable to load subscription history", errorMessage(problem, "Please try again when you are online."));
    } finally {
      subscriptionHistoryLock.current = false;
      setSubscriptionPageLoading(false);
    }
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
      let failureLocation = "connectivity_check";
      try {
        const connectivity = await checkConnectivity();
        if (connectivity === "offline") {
          failureLocation = "offline_session_restore";
          const offlineSession = await readOfflineSession();
          const cached = offlineSession
            ? await readCachedAccount(offlineSession.accountId)
            : null;
          if (live && offlineSession && cached && validBackup(cached)) {
            const local = withDeviceLanguage(cached);
            offlineAccountRef.current = offlineSession.accountId;
            setData(local);
            dataRef.current = local;
            persistedRef.current = local;
            setRoute({ screen: (local.shopComplete ?? Boolean(local.shop.name.trim() && local.shop.owner.trim())) ? "home" : "setup" });
          } else if (live) {
            setRoute({ screen: "login" });
            Alert.alert(
              "You’re offline",
              "Connect to Wi-Fi or another network to sign in.",
            );
          }
          return;
        }
        failureLocation = "session_restore_and_account_load";
        const remote = await api.restoreSession();
        if (live && remote) {
          failureLocation = "server_response_normalization";
          let parsed = api.normalizeData(remote);
          if (!validBackup(parsed)) throw new Error("Invalid server data");
          const id = parsed.shopExists ? accountKey(parsed.shop.phone) : "";
          offlineAccountRef.current = id || null;
          if (id && offlineStorageAvailable()) {
            failureLocation = "pending_offline_sync";
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
              failureLocation = "offline_cache_write";
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
          parsed = withDeviceLanguage(parsed);
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
        if (__DEV__) {
          const stack = error instanceof Error && error.stack
            ? error.stack.split("\n").slice(1).join("\n")
                .replace(/https?:\/\/[^\s)]+/gi, "[URL]")
                .replace(/\b[6-9]\d{9}\b/g, "[PHONE]")
                .replace(/(authorization|bearer|token|password|otp|secret)\s*[:= ]\s*[^\s,;]+/gi, "$1=[REDACTED]")
                .slice(0, 3000)
            : undefined;
          console.error("Digital-Khata startup operation failed", {
            location: failureLocation,
            errorName: error instanceof Error ? error.name : "UnknownError",
            category: error instanceof api.ApiTransportError
              ? error.kind
              : error instanceof api.ApiError
                ? error.status === 401 ? "authentication" : error.status === 409 ? "conflict" : error.status === 429 ? "rate_limit" : error.status >= 500 ? "server" : "http_error"
                : "local_or_unexpected",
            ...(error instanceof api.ApiError ? { status: error.status, code: error.payload?.code } : {}),
            ...(stack ? { stack } : {}),
          });
        }
        const canUseCachedSession =
          isOfflineError(error) ||
          (error instanceof api.ApiError && isTemporaryBackendFailure(error.status));
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
            const local = withDeviceLanguage(cached);
            offlineAccountRef.current = offlineSession.accountId;
            setData(local);
            dataRef.current = local;
            persistedRef.current = local;
            setRoute({ screen: (local.shopComplete ?? Boolean(local.shop.name.trim() && local.shop.owner.trim())) ? "home" : "setup" });
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
            errorMessage(error, "Something went wrong"),
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
    let live = true;
    const revisionAtRead = languagePreferenceRevision.current;
    void readLanguagePreference().then((language) => {
      if (!live || !language || languagePreferenceRevision.current !== revisionAtRead) return;
      const next = { ...dataRef.current, language };
      languageChosenRef.current = true;
      activeLanguageRef.current = language;
      localRevision.current += 1;
      dataRef.current = next;
      setData(next);
      if (persistedRef.current?.signedIn)
        persistedRef.current = { ...persistedRef.current, language };
    }).catch(() => { /* Language selection is optional if SecureStore is unavailable. */ });
    return () => { live = false; };
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
  function commit(next: Data, previousOverride?: Data): Promise<boolean> {
    if (loadError) return Promise.resolve(false);
    const previous = previousOverride || dataRef.current;
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
              if (dataRef.current === next) setData(next);
              return true;
            }
            localRevision.current += 1;
            void refreshSyncStatus(accountId);
            const revision = localRevision.current;
            persistedRef.current = next;
            if (dataRef.current === next) setData(next);
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
        if (dataRef.current === next) setData(next);
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
          Alert.alert("Unable to save", errorMessage(error, "Please try again."));
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
  function selectLanguage(language: string) {
    languageChosenRef.current = true;
    languagePreferenceRevision.current += 1;
    const next = { ...dataRef.current, language };
    // Language is device-local presentation state. Persist it locally without
    // creating a versioned shop-settings write or queue entry.
    dataRef.current = next;
    activeLanguageRef.current = language;
    localRevision.current += 1;
    setData(next);
    void saveLanguagePreference(language).catch(() => {});
    const accountId = offlineAccountRef.current;
    if (accountId && offlineStorageAvailable())
      void saveLocalLanguagePreference(accountId, language).catch(() => {});
    if (persistedRef.current?.signedIn)
      persistedRef.current = { ...persistedRef.current, language };
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
      Alert.alert("Unable to set up your shop", errorMessage(error, "Something went wrong"));
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
  const financialPalette = {
    red: { text: colors.red, background: colors.redBg, border: colors.redBorder },
    green: { text: colors.green, background: colors.greenBg, border: colors.greenBorder },
    blue: { text: colors.blue, background: colors.blueBg, border: colors.blueBorder },
    amber: { text: colors.orange, background: colors.amberBg, border: colors.amberBorder },
    neutral: { text: colors.neutral, background: colors.neutralBg, border: colors.neutralBorder },
  };
  type FinancialTone = keyof typeof financialPalette;
  const toneForBalance = (amount: number): FinancialTone =>
    amount > 0 ? "red" : amount < 0 ? "green" : "neutral";
  const khataBalanceCard = (label: string, signedBalance: number) => {
    const balanceDisplay = khataBalanceDisplay(signedBalance);
    const palette = financialPalette[balanceDisplay.tone];
    return (
      <Card style={{ backgroundColor: palette.background, borderColor: palette.border }}>
        <Hint style={{ color: palette.text }}>{label}</Hint>
        <Text style={[s.stat, { color: palette.text }]}>
          {`${money(balanceDisplay.amount)} ${balanceDisplay.position}`}
        </Text>
      </Card>
    );
  };
  const stat = (label: string, value: string, tone: FinancialTone = "neutral") => {
    const palette = financialPalette[tone];
    return (
      <Card style={{ flex: 1, backgroundColor: palette.background, borderColor: palette.border }}>
        <Text style={s.statLabel}>{label}</Text>
        <Text style={[s.stat, { color: palette.text }]}>{value}</Text>
      </Card>
    );
  };
  const actions = (id?: string) => (
    id && !isActiveCustomer(data.customers.find((item) => item.id === id) || {}) ? null :
    <>
      <View style={s.split}>
        <View style={{ flex: 1 }}>
          <Button title="+ Give Udhari" danger onPress={() => go("credit", id)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Receive Money / Add Advance" onPress={() => go("payment", id)} />
        </View>
      </View>
      {id && balance(data, id) < 0 && (
        <Button title="Refund Advance (एडवांस वापस करें)" orange onPress={() => go("refund", id)} />
      )}
    </>
  );
  const customerRow = (c: Customer) => {
    const signedBalance = balance(data, c.id);
    const { tone, label } = customerBalanceDisplay(signedBalance, money);
    return (
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
              <Text style={s.small}>{c.phone || t("No phone added", data.language)}</Text>
              {c.address ? <Text style={s.small}>{c.address}</Text> : null}
              <Text style={s.small}>
                Created On: {formatCustomerCreatedOn(c.createdAt)}
              </Text>
            </View>
            <Text style={{ color: financialPalette[tone].text, fontWeight: "700" }}>
              {label}
            </Text>
          </View>
        </Card>
      </Pressable>
    );
  };
  const managedCustomerRow = (c: Customer) => {
    const state = customerLifecycleState(c);
    const saving = savingCustomers[c.id];
    const { tone, label } = customerBalanceDisplay(balance(data, c.id), money);
    return (
      <Card key={c.id}>
        <View style={[s.split, { alignItems: "center" }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>{c.name}</Text>
            <Text style={s.small}>{c.phone || t("No phone added", data.language)}</Text>
            {c.address ? <Text style={s.small}>{c.address}</Text> : null}
          </View>
          <View style={[s.badge, { backgroundColor: state === "removed" ? colors.redBg : state === "disabled" ? colors.neutralBg : colors.greenBg }]}>
            <Text style={{ color: state === "removed" ? colors.red : state === "disabled" ? colors.neutral : colors.green, fontWeight: "700" }}>
              {state === "active" ? t("Active", data.language) : t(state === "disabled" ? "Disabled" : "Removed", data.language)}
            </Text>
          </View>
        </View>
        <Text style={{ color: financialPalette[tone].text, fontWeight: "700", marginTop: 8 }}>{label}</Text>
        <View style={[s.split, { marginTop: 8 }]}>
          <View style={{ flex: 1 }}><Button title="View Customer" secondary onPress={() => go("customer", c.id)} /></View>
          <View style={{ flex: 1 }}><Button title="Statement" secondary onPress={() => go("statement", c.id)} /></View>
        </View>
        {state === "active" ? (
          <>
            <View style={s.split}>
              <View style={{ flex: 1 }}><Button title="Edit Customer" disabled={Boolean(saving)} secondary onPress={() => go("customerForm", c.id)} /></View>
              <View style={{ flex: 1 }}><Button title="Disable Customer" loading={saving === "disabled"} disabled={Boolean(saving)} secondary onPress={() => changeCustomerLifecycle(c, "disabled")} /></View>
            </View>
            <Button title="Remove Customer" loading={saving === "removed"} disabled={Boolean(saving)} danger onPress={() => changeCustomerLifecycle(c, "removed")} />
          </>
        ) : state === "disabled" ? (
          <View style={s.split}>
            <View style={{ flex: 1 }}><Button title="Enable Customer" loading={saving === "active"} disabled={Boolean(saving)} onPress={() => changeCustomerLifecycle(c, "active")} /></View>
            <View style={{ flex: 1 }}><Button title="Remove Customer" loading={saving === "removed"} disabled={Boolean(saving)} danger onPress={() => changeCustomerLifecycle(c, "removed")} /></View>
          </View>
        ) : (
          <Button title="Restore Customer" loading={saving === "active"} disabled={Boolean(saving)} onPress={() => changeCustomerLifecycle(c, "active")} />
        )}
      </Card>
    );
  };
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
              color: financialPalette[e.type === "credit" ? "red" : e.type === "refund" ? "amber" : "green"].text,
            }}
          >
            {transactionAmountText(e, money)}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
  function saveCustomer() {
    const editing = data.customers.find((item) => item.id === route.id);
    if (editing && !isActiveCustomer(editing))
      return Alert.alert("Cannot edit this customer", "Enable or restore this customer before editing.");
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
      status: existingCustomer?.status ?? true,
      disabled: existingCustomer?.disabled ?? false,
      removed: existingCustomer?.removed ?? false,
    };
    const entitlement = subscriptionSnapshot?.current?.plan;
    const localCustomerLimit = entitlement?.customerLimit ?? 50;
    const hasUnlimitedCustomers = entitlement?.unlimitedCustomers ?? false;
    if (
      !route.id &&
      !hasUnlimitedCustomers &&
      data.customers.filter(isActiveCustomer).length >= localCustomerLimit
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
  function changeCustomerLifecycle(customer: Customer, target: CustomerLifecycleState) {
    const current = customerLifecycleState(customer);
    if (current === target) return;
    try { transitionCustomerLifecycle(customer, target); }
    catch { return Alert.alert("Customer status change not allowed", "This customer cannot be moved to that status."); }
    const signed = balance(data, customer.id);
    const due = Math.max(0, signed);
    const advance = Math.max(0, -signed);
    const confirmedAt = new Date().toISOString();
    const action = target === "disabled" ? "CUSTOMER_DISABLED" : target === "removed" ? "CUSTOMER_REMOVED" : current === "removed" ? "CUSTOMER_RESTORED" : "CUSTOMER_ENABLED";
    const eventId = uid();
    const event = {
      id: eventId,
      action,
      date: confirmedAt,
      customerLifecycle: {
        customerId: customer.id,
        previousStatus: current,
        newStatus: target,
      },
    };
    const reservation = customerActionGate.current.reserve(customer.id);
    if (!reservation) return;
    const confirmedAccount = offlineAccountRef.current;
    const perform = async () => {
      if (!customerActionGate.current.confirm(reservation)) return;
      setSavingCustomers((pending) => ({ ...pending, [customer.id]: target }));
      try {
        // Confirmation may remain open while sync or another customer's save finishes.
        const latest = dataRef.current;
        const latestCustomer = latest.customers.find((item) => item.id === customer.id);
        if (!latest.signedIn || offlineAccountRef.current !== confirmedAccount || !latestCustomer ||
            customerLifecycleState(latestCustomer) !== current) {
          Alert.alert("Customer status change not allowed", "This customer cannot be moved to that status.");
          return;
        }
        const saved = await commit({
          ...latest,
          customers: latest.customers.map((item) => item.id === customer.id ? transitionCustomerLifecycle(item, target) : item),
          audit: [event, ...latest.audit],
        });
        if (saved) Alert.alert(t(action === "CUSTOMER_DISABLED" ? "Customer disabled" : action === "CUSTOMER_ENABLED" ? "Customer enabled" : action === "CUSTOMER_REMOVED" ? "Customer removed" : "Customer restored", activeLanguageRef.current));
      } catch (error) {
        Alert.alert("Unable to save", errorMessage(error, "Please try again."));
      } finally {
        customerActionGate.current.finish(reservation);
        setSavingCustomers((pending) => {
          const next = { ...pending };
          delete next[customer.id];
          return next;
        });
      }
    };
    const removeMessage = due || advance
      ? `${customer.name}\n${due ? `${t("Outstanding", data.language)}: ${money(due)} ${t("Due", data.language)}` : `${t("Available Advance", data.language)}: ${money(advance)}`}\n\n${t("Removing hides this customer from active lists. Their balance and transaction history remain saved and can be accessed from Removed customers.", data.language)}`
      : t("Removing hides this customer from active lists. Their balance and transaction history remain saved and can be accessed from Removed customers.", data.language);
    const title = target === "disabled" ? "Disable customer?" : target === "removed" ? "Remove Customer?" : target === "active" ? (current === "removed" ? "Restore Customer?" : "Enable Customer?") : "Customer status";
    const message = target === "removed" ? removeMessage : target === "disabled"
      ? t("This customer will not be available for new transactions until enabled.", data.language)
      : t("This customer will be available for normal transactions again.", data.language);
    Alert.alert(t(title, data.language), message, [
      { text: t("Cancel", data.language), style: "cancel", onPress: () => customerActionGate.current.cancel(reservation) },
      { text: t(target === "disabled" ? "Disable Customer" : target === "removed" ? "Remove Customer" : target === "active" && current === "removed" ? "Restore Customer" : "Enable Customer", data.language), style: target === "removed" ? "destructive" : "default", onPress: () => void perform() },
    ], { cancelable: true, onDismiss: () => customerActionGate.current.cancel(reservation) });
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
    if (!isActiveCustomer(c))
      return Alert.alert("Customer is unavailable for transactions", "Enable or restore this customer before recording financial transactions.");
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
    if (!validDate(form.date))
      return Alert.alert(
        "Invalid date",
        "Use a valid date in YYYY-MM-DD format.",
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
      file.write(backup ? JSON.stringify(api.normalizeData(data), null, 2) : csv);
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
  let virtualizedRows: {
    data: any[];
    keyExtractor: (item: any) => string;
    renderItem: (item: any) => React.ReactElement;
    header?: React.ReactNode;
    footer?: React.ReactNode;
    empty?: React.ReactNode;
  } | null = null;
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
          <LanguagePicker value={data.language} onChange={selectLanguage} />
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
                setOtpHint(result.developmentCode
                  ? { key: "Local development OTP: {{code}}", parameters: { code: result.developmentCode } }
                  : { key: "A verification code was sent by SMS." });
                setSeconds(30);
                go("otp");
              } catch (error) {
                showOtpError("Could not send OTP", error, "Please try again.", activeLanguageRef.current);
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
          <Hint>{otpHint
            ? t(otpHint.key, data.language, otpHint.parameters)
            : t("Verification code sent to +91 {{phone}}", data.language, { phone })}</Hint>
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
                setOtpHint(result.developmentCode
                  ? { key: "Local development OTP: {{code}}", parameters: { code: result.developmentCode } }
                  : { key: "A new verification code was sent by SMS." });
              } catch (error) { showOtpError("Could not resend OTP", error, "Please try again.", activeLanguageRef.current); }
            }}
          >
              <Text style={s.link}>
              {seconds
                ? t("Resend OTP in 00:{{seconds}}", data.language, { seconds: String(seconds).padStart(2, "0") })
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
                        activeLanguageRef.current,
                      );
                      return;
                    }
                    throw error;
                  }
                }
                if (languageChosenRef.current)
                  remote = { ...remote, language: activeLanguageRef.current };
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
              } catch (error) { showOtpError(otpVerified ? "Could not load your account" : "Could not verify OTP", error, "Something went wrong", activeLanguageRef.current); }
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
          <LanguagePicker value={data.language} onChange={selectLanguage} />
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
            {stat("Current Outstanding", money(financial.outstandingPaise / 100), financial.outstandingPaise > 0 ? "red" : "neutral")}
            {stat("Total Udhari", money(financial.totalUdhariPaise / 100), "blue")}
          </View>
          <View style={s.split}>
            {stat("Total Money Received", money(financial.totalReceivedPaise / 100), "green")}
            {stat("Udhari Recovered", money(financial.totalUdhariRecoveredPaise / 100), "green")}
          </View>
          <View style={s.split}>
            {stat("Available Advances", money(financial.availableAdvancePaise / 100), financial.availableAdvancePaise > 0 ? "green" : "neutral")}
            {stat("Advance Deposited", money(financial.totalAdvanceDepositedPaise / 100), "blue")}
          </View>
          <View style={s.split}>
            {stat("Advance Refunded", money(financial.totalAdvanceRefundedPaise / 100), "amber")}
            {stat("Customers", String(data.customers.filter(isActiveCustomer).length))}
          </View>
          <Hint>Current outstanding and advances are balances. The other totals show recorded activity.</Hint>
          {actions()}
          <View style={s.split}>
            {stat(
              "This month’s udhari",
              money(periodUdhari(data, today().slice(0, 7))),
              "blue",
            )}
            {stat(
              "This month’s collection",
              money(periodReceived(data, today().slice(0, 7))),
              "green",
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
            .filter((c) => isActiveCustomer(c) && balance(data, c.id) > 0)
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
      const list = matchingCustomers;
      const page = pageRecords(list);
      virtualizedRows = {
        data: page.items,
        keyExtractor: (customer) => customer.id,
        renderItem: (customer) => customerRow(customer),
        header: <>
          <Field
            label="Search customers"
            placeholder="Search name or phone"
            value={search}
            onChangeText={setSearch}
          />
          <Chips
            items={["All", "Due", "Paid"]}
            value={filter}
            onChange={setFilter}
          />
        </>,
        footer: <>
          {listFooter(page.hasMore, "Loading more customers...")}
          <Button title="+ Add Customer" onPress={() => go("customerForm")} />
        </>,
        empty: !list.length ? <Empty title="No customers found" description="Add a customer or try a different search." /> : null,
      };
      break;
    }
    case "manageCustomers": {
      const page = pageRecords(managedCustomers);
      virtualizedRows = {
        data: page.items,
        keyExtractor: (item) => item.id,
        renderItem: (item) => managedCustomerRow(item),
        header: <>
          <Field label="Search customers" placeholder="Search name or phone" value={search} onChangeText={setSearch} />
          <Chips items={["All", "Disabled", "Removed"]} value={manageCustomerFilter} onChange={setManageCustomerFilter} />
        </>,
        footer: listFooter(page.hasMore, ""),
        empty: !loaded ? <View style={{ paddingVertical: 12, alignItems: "center" }}><ActivityIndicator size="small" color={colors.green} /></View> : <Empty title={manageCustomerFilter === "All" ? "No customers found" : manageCustomerFilter === "Disabled" ? "No disabled customers" : "No removed customers"} description="Try another search or customer status." />,
      };
      break;
    }
    case "customerForm":
      content = (
        <>
          {route.id && customer && !isActiveCustomer(customer) ? <Hint>{t("Cannot edit this customer", data.language)}. {t("Enable or restore this customer before editing.", data.language)}</Hint> : null}
          {field("Name *", "name", { placeholder: "Rahul Kumar", editable: !route.id || isActiveCustomer(customer || {}) })}
          {field("Phone Number", "phone", {
            keyboardType: "phone-pad",
            maxLength: 32,
            placeholder: "98XXXXXXXX",
            editable: !route.id || isActiveCustomer(customer || {}),
          })}
          {field("Address", "address", { placeholder: "Delhi", multiline: true, editable: !route.id || isActiveCustomer(customer || {}) })}
          {route.id && customer ? (
            <Field
              label="Created On"
              value={formatCustomerCreatedOn(customer.createdAt)}
              editable={false}
            />
          ) : null}
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
            editable: !route.id || isActiveCustomer(customer || {}),
          })}
          <Toggle
            label="Allow WhatsApp / SMS reminders"
            value={form.reminder === "true"}
            onChange={(v) => f("reminder", String(v))}
            disabled={!!route.id && !isActiveCustomer(customer || {})}
          />
          <Button
            title="Save Customer"
            disabled={busy || (!!route.id && !isActiveCustomer(customer || {}))}
            onPress={saveCustomer}
          />
        </>
      );
      break;
    case "customer":
      if (customer) {
        const entries = data.entries
          .filter((e) => e.customerId === customer.id)
          .slice()
          .sort((a, b) => b.date.localeCompare(a.date));
        const historyItems: { id: string; element: React.ReactElement }[] = [];
        if (customer.opening > 0)
          historyItems.push({ id: "opening-udhari", element: <Row title="Opening Udhari" subtitle={customer.openingDate || customer.createdAt?.slice(0, 10)} value={money(Math.abs(customer.opening))} color={colors.red} /> });
        if ((customer.openingAdvance || 0) > 0)
          historyItems.push({ id: "opening-advance", element: <Row title="Opening Advance (जमा राशि)" subtitle={customer.openingDate || customer.createdAt?.slice(0, 10)} value={money(Math.abs(customer.openingAdvance || 0))} color={colors.green} /> });
        if (customer.opening > 0 && (customer.openingAdvance || 0) > 0)
          historyItems.push({ id: "opening-adjustment", element: <Row title="Opening Advance Adjusted Against Udhari" subtitle={t("Remaining advance: {{amount}}", data.language, { amount: money(Math.max(0, customer.openingAdvance! - customer.opening)) })} value={money(Math.min(customer.opening, customer.openingAdvance || 0))} color={colors.green} /> });
        historyItems.push(...entries.map((entry) => ({ id: entry.id, element: entryRow(entry) })));
        const transactionPage = pageRecords(historyItems);
        const customerFinancial = financialSummary(data, customer.id);
        const currentOutstandingPaise = customerFinancial.outstandingPaise;
        const availableAdvancePaise = customerFinancial.availableAdvancePaise;
        virtualizedRows = {
          data: transactionPage.items,
          keyExtractor: (item) => item.id,
          renderItem: (item) => item.element,
          header: <>
            <Hint>
              {customer.phone || "No phone number"} •{" "}
              {customer.address || "No address"}
            </Hint>
            <Card style={{ backgroundColor: financialPalette[currentOutstandingPaise > 0 ? "red" : availableAdvancePaise > 0 ? "green" : "neutral"].background, borderColor: financialPalette[currentOutstandingPaise > 0 ? "red" : availableAdvancePaise > 0 ? "green" : "neutral"].border }}>
              <Hint style={{ color: financialPalette[currentOutstandingPaise > 0 ? "red" : "neutral"].text }}>Current Outstanding</Hint>
              <Text style={[s.amount, { color: financialPalette[currentOutstandingPaise > 0 ? "red" : "neutral"].text }]}>{money(currentOutstandingPaise / 100)}</Text>
              <Hint style={{ color: financialPalette[availableAdvancePaise > 0 ? "green" : "neutral"].text }}>Available Advance: {money(availableAdvancePaise / 100)}</Hint>
            </Card>
            {customerLifecycleState(customer) === "active" ? actions(customer.id) : (
              <View style={[s.badge, { backgroundColor: customerLifecycleState(customer) === "removed" ? colors.redBg : colors.neutralBg }]}>
                <Text style={{ color: customerLifecycleState(customer) === "removed" ? colors.red : colors.neutral, fontWeight: "700" }}>{t(customerLifecycleState(customer) === "removed" ? "Removed" : "Disabled", data.language)}</Text>
              </View>
            )}
            <View style={s.split}>
              {stat(
                "Total Udhari",
                money(totalUdhari(data, customer.id)),
                "blue",
              )}
              {stat(
                "Total Money Received",
                money(customerFinancial.totalReceivedPaise / 100),
                "green",
              )}
            </View>
            <View style={s.split}>
              {stat("Udhari Recovered", money(customerFinancial.totalUdhariRecoveredPaise / 100), "green")}
              {stat("Advance Deposited", money(customerFinancial.totalAdvanceDepositedPaise / 100), "blue")}
            </View>
            <View style={s.split}>
              {stat("Advance Refunded", money(customerFinancial.totalAdvanceRefundedPaise / 100), "amber")}
              {stat("Available Advance", money(availableAdvancePaise / 100), availableAdvancePaise > 0 ? "green" : "neutral")}
            </View>
            <View style={s.split}>
              {customerLifecycleState(customer) === "active" ? <View style={{ flex: 1 }}>
                <Button
                  title="View Customer"
                  secondary
                  onPress={() => go("viewCustomer", customer.id)}
                />
              </View> : null}
            </View>
            <View style={s.split}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Statement"
                  secondary
                  onPress={() => go("statement", customer.id)}
                />
              </View>
              {customerLifecycleState(customer) === "active" ? <View style={{ flex: 1 }}>
                <Button title="Edit Customer" secondary onPress={() => go("customerForm", customer.id)} />
              </View> : null}
            </View>
            <Title>Transaction History</Title>
          </>,
          footer: listFooter(transactionPage.hasMore),
          empty: !historyItems.length ? <Empty title="No transactions yet" description="Opening outstanding is included in the outstanding amount." /> : null,
        };
      }
      break;
    case "viewCustomer":
      if (customer) {
        const customerFinancial = financialSummary(data, customer.id);
        const outstandingTone = customerFinancial.outstandingPaise > 0 ? "red" : "neutral";
        const advanceTone = customerFinancial.availableAdvancePaise > 0 ? "green" : "neutral";
        content = (
          <>
            <Title>Personal Information</Title>
            <Card>
              <Row title="Customer Name" value={customer.name} />
              <Row title="Mobile Number" value={customer.phone || "Not provided"} />
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>Address</Text>
                  <Text style={s.small}>{customer.address || "Not provided"}</Text>
                </View>
              </View>
              <Row title="Created On" value={formatCustomerCreatedOn(customer.createdAt)} />
              <Row title="Credit Limit" value={money(Math.abs(customer.limit || 0))} />
              <Row title="Reminders" value={customer.reminder ? "Allowed" : "Off"} />
            </Card>
            <Title>Financial Information</Title>
            <Card>
              <Row title="Opening Udhari" value={money(Math.abs(customer.opening))} color={colors.red} />
              <Row title="Opening Advance" value={money(Math.abs(customer.openingAdvance || 0))} color={colors.green} />
              <Row title="Current Outstanding" value={money(customerFinancial.outstandingPaise / 100)} color={financialPalette[outstandingTone].text} />
              <Row title="Available Advance" value={money(customerFinancial.availableAdvancePaise / 100)} color={financialPalette[advanceTone].text} />
            </Card>
          </>
        );
      } else {
        content = <Empty title="Customer unavailable" description="This customer is not available in the current shop data." />;
      }
      break;
    case "credit":
    case "payment":
    case "refund":
    case "editTransaction":
      content = (
        <>
          {route.id && !isActiveCustomer(data.customers.find((item) => item.id === route.id) || {}) ? <Hint>{t("Customer is unavailable for transactions", data.language)}. {t("Enable or restore this customer before recording financial transactions.", data.language)}</Hint> : null}
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
                onScroll={handleListScroll}
                scrollEventThrottle={16}
              >
                {(() => {
                  const selectionPage = pageRecords(matchingCustomers);
                  return <>
                  {selectionPage.items.map((c) => {
                    const signedBalance = balance(data, c.id);
                    const { tone, label } = customerBalanceDisplay(signedBalance, money);
                    const balancePalette = financialPalette[tone];
                    return (
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
                            {[c.phone, c.address]
                              .filter(Boolean)
                              .join(" • ")}
                          </Text>
                        </View>
                        <Text
                          style={{
                            color: balancePalette.text,
                            backgroundColor: balancePalette.background,
                            borderColor: balancePalette.border,
                            borderWidth: 1,
                            borderRadius: 5,
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            fontSize: 12,
                            fontWeight: "600",
                          }}
                        >
                          {label}
                        </Text>
                        {form.customerId === c.id && (
                          <Icon name="checkmark-circle" color="white" size={20} />
                        )}
                      </Pressable>
                    );
                  })}
                  {listFooter(selectionPage.hasMore)}
                  </>;
                })()}
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
              {route.screen !== "credit" && entry?.type !== "credit" ? (
                <>
                  <Title>Payment Method</Title>
                  <Chips
                    items={["Cash", "UPI", "Bank", "Other"]}
                    value={form.method}
                    onChange={(v) => f("method", v)}
                  />
                </>
              ) : null}
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
              <Text style={[s.amount, { color: financialPalette[entry.type === "credit" ? "red" : entry.type === "refund" ? "amber" : "green"].text }]}>{transactionAmountText(entry, money)}</Text>
              <View style={[s.badge, { backgroundColor: financialPalette[entry.type === "credit" ? "red" : entry.type === "refund" ? "amber" : "green"].background }]}>
                <Text style={{ color: financialPalette[entry.type === "credit" ? "red" : entry.type === "refund" ? "amber" : "green"].text, fontWeight: "700" }}>
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
            {isActiveCustomer(data.customers.find((item) => item.id === entry.customerId) || {}) ? <Button
              title="Edit"
              onPress={() => go("editTransaction", entry.id)}
            /> : <Hint>{t("Historical transactions are read-only.", data.language)}</Hint>}
            {isActiveCustomer(data.customers.find((item) => item.id === entry.customerId) || {}) ? <Button title="Delete" danger onPress={() => deleteEntry(entry)} /> : null}
          </>
        );
      }
      break;
    case "khata": {
      const transactionPage = pageRecords(khataRows);
      const groups = new Map<string, { customer: Customer; summary: ReturnType<typeof monthly>; entries: Entry[] }>();
      for (const row of transactionPage.items) {
        const group = groups.get(row.customer.id);
        if (group) group.entries.push(row.entry);
        else groups.set(row.customer.id, { customer: row.customer, summary: row.summary, entries: [row.entry] });
      }
      virtualizedRows = {
        data: [...groups.values()],
        keyExtractor: (group) => group.customer.id,
        renderItem: ({ customer: c, summary: m, entries }) => (
          <Pressable accessibilityRole="button" onPress={() => go("statement", c.id)}>
            <Card>
              <Title>{c.name}</Title>
              {khataBalanceCard("Opening Balance", m.opening)}
              <Row title="Udhari Given" value={money(m.credit)} color={colors.blue} />
              <Row title="Payment Received" value={money(m.payment)} color={colors.green} />
              {m.refund > 0 && <Row title="Advance Refunded" value={money(m.refund)} color={colors.orange} />}
              {khataBalanceCard("Closing Balance", m.closing)}
              {entries.map((entry: Entry) => (
                <Row
                  key={entry.id}
                  title={entry.note || entryLabel(entry.type)}
                  subtitle={entry.date}
                  value={transactionAmountText(entry, money)}
                  color={financialPalette[entry.type === "credit" ? "red" : entry.type === "refund" ? "amber" : "green"].text}
                  onPress={() => go("transaction", entry.id)}
                />
              ))}
            </Card>
          </Pressable>
        ),
        header: <>
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
        </>,
        footer: listFooter(transactionPage.hasMore),
        empty: !data.customers.some((customer) => khataCustomerMatchesSearch(customer.name, search))
          ? <Empty title={data.customers.length ? "No matching customers" : "Your monthly khata"} description={data.customers.length ? "Try a different customer search." : "Customer balances will appear here after you add customers."} />
          : <Empty title="No matching transactions" description={t("No {{items}} for this customer search and month.", data.language, { items: t(filter === "All" ? "transactions" : filter === "Udhari" ? "Udhari transactions" : "payments", data.language) })} />,
      };
      break;
    }
    case "statement":
      if (customer) {
        const m = monthly(data, customer.id, month);
        const statementPage = pageRecords(m.entries);
        virtualizedRows = {
          data: statementPage.items,
          keyExtractor: (entry) => entry.id,
          renderItem: (e) => (
            <Row
              title={e.note || entryLabel(e.type)}
              subtitle={e.date}
              value={transactionAmountText(e, money)}
              color={financialPalette[e.type === "credit" ? "red" : e.type === "refund" ? "amber" : "green"].text}
              onPress={() => go("transaction", e.id)}
            />
          ),
          header: <>
            {monthPicker(
              customer.createdAt ? monthForDate(customer.createdAt) : undefined,
              today().slice(0, 7),
            )}
            <Card>
              <Title>{data.shop.name}</Title>
              <Hint>{data.shop.address}</Hint>
              <Text style={s.rowTitle}>{customer.name}</Text>
              {khataBalanceCard("Opening Balance", m.opening)}
            </Card>
          </>,
          footer: <>
            {listFooter(statementPage.hasMore)}
            <Card>
              <Row title="Udhari Given" value={money(m.credit)} color={colors.blue} />
              <Row title="Payment Received" value={money(m.payment)} color={colors.green} />
              {m.refund > 0 && <Row title="Advance Refunded" value={money(m.refund)} color={colors.orange} />}
              {khataBalanceCard("Closing Balance", m.closing)}
              <Hint>
                Opening Balance = Previous Period’s Closing Balance. For the first recorded period, the original opening position is Opening Outstanding − Opening Advance; those amounts are included in that period’s activity.
              </Hint>
              <Hint>
                Closing Balance = Opening Balance + Udhari Given − Payment Received + Advance Refunded ± Other Adjustments (if supported). Positive = Outstanding; negative = Advance; zero = Settled.
              </Hint>
              <Hint>
                Current Outstanding = MAX(0, Closing Balance). Available Advance = MAX(0, −Closing Balance).
              </Hint>
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
          </>,
          empty: !statementPage.items.length ? <Empty title="No transactions in this period" description="The opening and closing balances still reflect the full selected period." /> : null,
        };
      }
      break;
    case "share":
      if (customer)
        content = (
          <>
            <Title>
              {customer.name} • {monthLabel(month)}
            </Title>
            <Card style={{ backgroundColor: financialPalette[toneForBalance(monthly(data, customer.id, month).closing)].background, borderColor: financialPalette[toneForBalance(monthly(data, customer.id, month).closing)].border }}>
              <Hint>Outstanding</Hint>
              <Text style={[s.amount, { color: financialPalette[toneForBalance(monthly(data, customer.id, month).closing)].text }]}>
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
            <Button title={t("Open {{channel}}", data.language, { channel })} onPress={sendStatement} />
            <Hint>You can review and send the message in {channel}.</Hint>
          </>
        );
      break;
    case "notifications":
      {
      const noticesPage = pageRecords(notices);
      const recentActivityPage = pageRecords(data.audit.slice(0, 30));
      content = (
        <>
          <Hint>Account updates and delivery activity</Hint>
          {noticesPage.items.map((notice) => (
            <Card key={notice.id} style={{ backgroundColor: notice.read ? "white" : colors.pale }}>
              <Row title={notice.title} subtitle={`${notice.body}\n${new Date(notice.date).toLocaleString("en-IN")}`} value={notice.read ? "Read" : "New"} onPress={() => {
                if (notice.read) return;
                api.markNotificationsRead([notice.id]).then(() => setNotices(old => old.map(n => n.id === notice.id ? { ...n, read: true } : n))).catch(error => Alert.alert("Unable to update", errorMessage(error, "Please try again.")));
              }} />
            </Card>
          ))}
          {listFooter(noticesPage.hasMore)}
          <Hint>Recent activity</Hint>
          {data.audit.length === 0 && (
            <Empty
              title="You’re all caught up"
              description="New customers and transaction confirmations appear here."
            />
          )}
          {recentActivityPage.items.map((a) => (
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
          {listFooter(recentActivityPage.hasMore)}
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
      }
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
            {stat("Monthly Udhari", money(totalCredit), "blue")}
            {stat("Collection", money(totalPayment), "green")}
          </View>
          <View style={s.split}>
            {stat("Outstanding (all time)", money(outstanding), outstanding > 0 ? "red" : "neutral")}
            {stat(
              "Active customers",
              String(new Set(monthEntries.filter((entry) => isActiveCustomer(data.customers.find((item) => item.id === entry.customerId) || {})).map((e) => e.customerId)).size),
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
                      backgroundColor: colors.blue,
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
              color={colors.green}
            />
            <Row
              title="Pending"
              value={String(
                data.customers.filter((c) => balance(data, c.id) > 0).length,
              )}
              color={colors.red}
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
              "manageCustomers",
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
          <LanguagePicker value={data.language} onChange={selectLanguage} />
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
      const historyPage = pageRecords(subscriptionSnapshot?.history || []);
      const selected = plans.find((item) => item.name === plan || item.code === plan.toLowerCase());
      const duration = Number(subscriptionDuration);
      const price = selected?.durations.find((item) => item.months === duration);
      const asRupees = (minor?: number | null) => money((minor || 0) / 100);
      const remainingText = current?.expiresAt
        ? current.remainingMilliseconds !== null && current.remainingMilliseconds < 86400000
          ? t("{{hours}} hours {{minutes}} minutes remaining", data.language, { hours: Math.max(0, Math.floor(current.remainingMilliseconds / 3600000)), minutes: Math.max(0, Math.floor((current.remainingMilliseconds % 3600000) / 60000)) })
          : t("{{days}} days remaining", data.language, { days: current.remainingDays ?? 0 })
        : t("Never expires", data.language);
      content = (
        <>
          {current && (
            <Card>
              <Title>Current Subscription</Title>
              <Row title="Plan" value={current.plan.name} />
              <Row title="Status" value={t("Active", data.language)} />
              <Row title="Start date" value={current.startsAt ? new Date(current.startsAt).toLocaleDateString("en-IN") : "—"} />
              <Row title="Expiry" value={current.expiresAt ? new Date(current.expiresAt).toLocaleDateString("en-IN") : t("Never", data.language)} />
              <Row title="Time remaining" value={remainingText} />
              <Row title="Customer limit" value={current.customerUsage.unlimited ? t("Unlimited", data.language) : String(current.customerUsage.limit ?? 0)} />
              <Row title="Customers used" value={String(current.customerUsage.used)} />
              {!current.customerUsage.unlimited && <Row title="Customer capacity left" value={String(current.customerUsage.remaining ?? 0)} />}
              {current.durationMonths > 0 && <Row title="Duration" value={t("{{count}} months", data.language, { count: current.durationMonths })} />}
              {current.amountPaidMinor !== null && <Row title="Amount paid" value={asRupees(current.amountPaidMinor)} />}
              {current.scheduled && (
                <>
                  <Title>Next Scheduled Plan</Title>
                  <Row title="Plan" value={current.scheduled.plan.name} />
                  <Row title="Starts" value={new Date(current.scheduled.startsAt).toLocaleDateString("en-IN")} />
                  <Row title="Activation" value={t("Starts in {{days}} days", data.language, { days: Math.max(0, Math.ceil((new Date(current.scheduled.startsAt).getTime() - Date.now()) / 86400000)) })} />
                  <Row title="Duration" value={t("{{count}} months", data.language, { count: current.scheduled.durationMonths })} />
                </>
              )}
              {current.isFallback && <Hint>{t("Free plan • ₹0 • 50 customers • Expiry: Never", data.language)}</Hint>}
            </Card>
          )}
          {(subscriptionSnapshot?.history || []).length > 0 && (
            <>
              <Title>Subscription History</Title>
              {historyPage.items.map((item) => {
                const timeRemaining = item.remainingMilliseconds;
                const remaining = timeRemaining !== null && timeRemaining < 86400000
                  ? t("{{hours}} hours {{minutes}} minutes remaining", data.language, { hours: Math.floor(timeRemaining / 3600000), minutes: Math.floor((timeRemaining % 3600000) / 60000) })
                  : t("{{days}} days remaining", data.language, { days: item.remainingDays ?? 0 });
                const startsIn = item.startsInDays !== null
                  ? t("Starts in {{days}} days", data.language, { days: item.startsInDays })
                  : null;
                return (
                  <Card key={item.id}>
                    <Title>{item.plan?.name || item.plan?.code || "Subscription"}</Title>
                    <Row title="Status" value={item.status} />
                    {item.startsAt && <Row title="Starts" value={new Date(item.startsAt).toLocaleDateString("en-IN")} />}
                    {item.expiresAt && <Row title="Expires" value={new Date(item.expiresAt).toLocaleDateString("en-IN")} />}
                    {item.status === "active" && item.remainingMilliseconds !== null && <Row title="Time remaining" value={remaining} />}
                    {startsIn && <Row title="Activation" value={startsIn} />}
                    <Row title="Duration" value={t("{{count}} months", data.language, { count: item.durationMonths })} />
                    {item.amountPaidMinor !== null && <Row title="Amount paid" value={asRupees(item.amountPaidMinor)} />}
                  </Card>
                );
              })}
              {listFooter(historyPage.hasMore || !!subscriptionSnapshot?.historyNextCursor)}
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
                <Hint>{item.unlimitedCustomers ? t("Unlimited customers", data.language) : t("{{count}} customers", data.language, { count: item.customerLimit ?? 0 })}</Hint>
              </Card>
            </Pressable>
          ))}
          {selected && selected.code !== "free" && (
            <Card>
              <Title>Subscription duration</Title>
              <Chips items={selected.durations.map((item) => t("{{count}} months", data.language, { count: item.months }))} value={t("{{count}} months", data.language, { count: duration })} onChange={(value) => setSubscriptionDuration(value.split(" ")[0])} />
              {price && (
                <>
                  {price.discountPercent > 0 && <Hint>{t("Save {{discountPercent}}% for {{months}} months", data.language, { discountPercent: price.discountPercent, months: price.months })}</Hint>}
                  <Row title="Original amount" value={asRupees(price.originalAmountMinor)} />
                  <Row title={t("Discount ({{percent}}%)", data.language, { percent: price.discountPercent })} value={`−${asRupees(price.discountAmountMinor)}`} />
                  <Row title={price.taxInclusive ? t("Tax ({{rate}}%) included", data.language, { rate: (price.taxRateBps / 100).toFixed(2) }) : t("Tax ({{rate}}%)", data.language, { rate: (price.taxRateBps / 100).toFixed(2) })} value={asRupees(price.taxAmountMinor)} />
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
      {
      const paymentsPage = pageRecords(subscriptionSnapshot?.payments || []);
      virtualizedRows = {
        data: paymentsPage.items,
        keyExtractor: (payment) => payment.id,
        renderItem: (payment) => (
          <Card>
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
        ),
        header: <Hint>
          {subscriptionSnapshot?.cachedAt
            ? `Cached history • Last synchronized ${new Date(subscriptionSnapshot.cachedAt).toLocaleString("en-IN")}`
            : "Payment history is unavailable offline until it has been synchronized."}
        </Hint>,
        footer: <>
          {listFooter(paymentsPage.hasMore || !!subscriptionSnapshot?.paymentsNextCursor)}
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
        </>,
        empty: (subscriptionSnapshot?.payments || []).length === 0 && !subscriptionLoading
          ? <Empty title="No payments yet" description="Verified subscription payments will appear here." />
          : null,
      };
      break;
      }
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
      {
      const activityPage = pageRecords(data.audit);
      const lifecycleActivityLabels: Record<string, string> = {
        CUSTOMER_DISABLED: "Customer disabled",
        CUSTOMER_ENABLED: "Customer enabled",
        CUSTOMER_REMOVED: "Customer removed",
        CUSTOMER_RESTORED: "Customer restored",
      };
      virtualizedRows = {
        data: activityPage.items,
        keyExtractor: (activity) => activity.id,
        header: <Hint>Server-recorded customer and transaction activity for this shop.</Hint>,
        renderItem: (a) => (
          <Card>
              <Title>{t(lifecycleActivityLabels[a.action] || a.action, data.language)}</Title>
              <Hint>{new Date(a.date).toLocaleString("en-IN")}</Hint>
              {a.before && typeof a.before.amount === "number" && (
                <Hint>
                  Before: {money(a.before.amount)} • {a.before.date} •{" "}
                  {a.before.note}
                </Hint>
              )}
              {a.after && typeof a.after.amount === "number" && (
                <Hint>
                  After: {money(a.after.amount)} • {a.after.date} •{" "}
                  {a.after.note}
                </Hint>
              )}
              {a.customerLifecycle && (
                <Hint>
                  {t("Customer status", data.language)}: {t(a.customerLifecycle.previousStatus[0].toUpperCase() + a.customerLifecycle.previousStatus.slice(1), data.language)} → {t(a.customerLifecycle.newStatus[0].toUpperCase() + a.customerLifecycle.newStatus.slice(1), data.language)}
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
        ),
        footer: listFooter(activityPage.hasMore),
        empty: !data.audit.length ? <Empty title="No activity yet" description="Changes you make to this khata will appear here." /> : null,
      };
      break;
      }
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
  if (!loaded && !data.signedIn)
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
          {virtualizedRows ? (
            <FlatList
              key={`${route.screen}-${route.id || ""}`}
              ref={virtualListRef}
              data={virtualizedRows.data}
              renderItem={({ item }) => virtualizedRows!.renderItem(item)}
              keyExtractor={(item) => virtualizedRows!.keyExtractor(item)}
              ListHeaderComponent={virtualizedRows.header ? <>{virtualizedRows.header}</> : null}
              ListFooterComponent={virtualizedRows.footer ? <>{virtualizedRows.footer}</> : null}
              ListEmptyComponent={virtualizedRows.empty ? <>{virtualizedRows.empty}</> : null}
              contentContainerStyle={s.content}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              initialNumToRender={PAGE_SIZE}
              maxToRenderPerBatch={10}
              windowSize={7}
              removeClippedSubviews={Platform.OS === "android"}
              onScroll={handleListScroll}
              onScrollBeginDrag={(event) => {
                if (route.screen === "customers" || route.screen === "manageCustomers") {
                  customerScrollStartedForKey.current = listPageKeyRef.current;
                  customerDragStartOffset.current = event.nativeEvent.contentOffset.y;
                  customerScrollGate.current.beginUserScroll();
                }
              }}
              onContentSizeChange={() => {
                if (restoredListKey.current === listPageKey) return;
                restoredListKey.current = listPageKey;
                const offset = route.screen === "manageCustomers" ? 0 : listScrollOffsets.current.get(listPageKey) || 0;
                if (offset > 0 || route.screen === "manageCustomers")
                  requestAnimationFrame(() => {
                    if (listPageKeyRef.current === listPageKey)
                      virtualListRef.current?.scrollToOffset({ offset, animated: false });
                  });
              }}
              onEndReached={() => {
                if (route.screen === "customers" || route.screen === "manageCustomers") {
                  if (
                    customerScrollStartedForKey.current === listPageKeyRef.current &&
                    customerScrollGate.current.claimPage()
                  ) {
                    listHasScrolled.current = true;
                    requestNextVisiblePage();
                  }
                } else if (listHasScrolled.current) requestNextVisiblePage();
              }}
              onEndReachedThreshold={0.35}
              scrollEventThrottle={16}
            />
          ) : (
            <ScrollView
              key={`${route.screen}-${route.id || ""}`}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.content}
              onScroll={handleListScroll}
              scrollEventThrottle={16}
            >
              {content}
            </ScrollView>
          )}
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
