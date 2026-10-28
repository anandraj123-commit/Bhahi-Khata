import { TransactionTypeBadge } from "./src/TransactionTypeBadge";
import { CustomerContactInfo } from "./src/CustomerContactInfo";
import { openCustomerContact } from "./src/customerContactActions";
import { updateCustomerContactForm } from "./src/customerContactForm";
import { formatCurrency, LanguageContext, showLocalizedAlert, t, Text } from "./src/i18n";
import { apiErrorTranslationKey } from "./src/localization";
import { isTemporaryBackendFailure } from "./src/startupRecovery";
import { readLanguagePreference, saveLanguagePreference } from "./src/languagePreference";
import { localeTag } from "./src/locales";
import { deviceClockNeedsWarning } from "./src/serverClock";
import { entryDateTime, formatClockTime, localDateTimeIso, parseClockTime, transactionLabel as entryLabel } from "./src/entryPresentation";
import { buildTransactionReceipt, authorizeReceiptAccess, receiptAccountIdentity, resolveReceiptAccountId } from "./src/transactionReceipt";
import { TransactionDetails } from "./src/TransactionDetails";
import { CustomerAccountStatementActions } from "./src/CustomerAccountStatementActions";
import { buildCustomerAccountStatement } from "./src/customerAccountStatement";
import { MonthlyKhataStatementActions } from "./src/MonthlyKhataStatementActions";
import { buildMonthlyKhataStatement } from "./src/monthlyKhataStatement";
import { DownloadReportActions } from "./src/DownloadReportActions";
import { ReportDatePicker } from "./src/ReportDatePicker";
import { buildDownloadReport, customReportDateState, type DownloadReport, type DownloadReportKind } from "./src/downloadReports";
import { DOWNLOAD_REPORT_PAGE_SIZE, nextDownloadReportCount, visibleDownloadReportTransactions } from "./src/downloadReportPagination";
import ErrorBoundary from "./src/ErrorBoundary";
import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import {
  ActivityIndicator,
  Alert as NativeAlert,
  BackHandler,
  FlatList,
  LayoutAnimation,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
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
  formatCustomerCreatedAt,
  formatCustomerCreatedOn,
} from "./src/customerPresentation";
import {
  khataBalanceDisplay,
  khataEntriesForTab,
  transactionAmountText,
} from "./src/khataPresentation";
import * as api from "./src/api";
import {
  cacheAuthenticatedAccount,
  cacheSubscriptionSnapshot,
  clearOfflineSubscriptionState,
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
  readReceiptSnapshot,
  retryFailedChanges,
  refreshConflict,
  refreshCustomerConflict,
  refreshSettingsConflict,
  saveLocalChange,
  type PendingConflict,
  type PendingCustomerConflict,
  type PendingSettingsConflict,
} from "./src/offlineStore";
import { isAccountSynchronizing, subscribeSyncState, synchronizeAccount, synchronizePendingOnly } from "./src/offlineSync";
import { syncStatusFromQueue, syncStatusUnavailable, type SyncStatusState } from "./src/syncStatus";
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
  evaluateOfflineSubscriptionClock,
  isOfflineEntitlementUsable,
  mergeVerifiedSubscriptionClockAnchor,
  type SubscriptionClockAnchor,
} from "./src/subscriptionClock";
import { launchCashfreeCheckout } from "./src/cashfreeCheckout";
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
  | "downloadReports"
  | "profile"
  | "settings"
  | "reminders"
  | "help"
  | "subscription"
  | "subscriptionPayments"
  | "referral"
  | "account"
  | "audit"
  | "deletedTransactions";
type Route = { screen: Screen; id?: string };
type HomeCustomerListKey = "outstanding" | "udhari" | "received" | "recovered" | "availableAdvance" | "deposited" | "refunded" | "customers";
type HomeCustomerSort = "date-desc" | "date-asc" | "name-asc" | "name-desc";
const subscriptionShopBindingKey = (accountId: string) => `dk.subscription.shop.${accountId}`;
const subscriptionClockAnchorKey = (accountId: string) => `dk.subscription.clock.${accountId}`;
async function markSubscriptionClock(accountId: string, shopId: string) {
  const key = subscriptionClockAnchorKey(accountId);
  const now = Date.now();
  let observedAt = now;
  try {
    const raw = await SecureStore.getItemAsync(key);
    const previous = raw ? JSON.parse(raw) as SubscriptionClockAnchor : null;
    observedAt = mergeVerifiedSubscriptionClockAnchor(previous, shopId, now).observedAt;
    await SecureStore.setItemAsync(key, JSON.stringify({ shopId, observedAt }));
  } catch { /* A missing secure clock anchor makes offline limits fail closed. */ }
}
async function isOfflineSubscriptionClockSafe(accountId: string, shopId: string, cachedAt?: number) {
  const now = Date.now();
  const key = subscriptionClockAnchorKey(accountId);
  try {
    const raw = await SecureStore.getItemAsync(key);
    const anchor = raw ? JSON.parse(raw) as SubscriptionClockAnchor : null;
    const result = evaluateOfflineSubscriptionClock({ now, shopId, anchor, cachedAt });
    if (!result.safe || !result.nextAnchor) return false;
    await SecureStore.setItemAsync(key, JSON.stringify(result.nextAnchor));
    return true;
  } catch { return false; }
}
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
          const serverMessage = error.payload?.error;
          if (error.status === 400 && error.payload?.code === "INVALID_TRANSACTION_RESTORATION")
            return "The restore request is invalid. Refresh Deleted Transactions and try again.";
          if (error.status === 401)
            return "Your sign-in has expired. Reconnect and sign in before synchronizing this transaction.";
          if (error.status === 403 && serverMessage === "Access denied")
            return "You are not authorized to restore this transaction.";
          if (error.status === 404 && serverMessage === "Transaction not found")
            return "Transaction not found in this shop.";
          if (error.status === 409 && error.payload?.code === "TRANSACTION_ALREADY_ACTIVE")
            return "This transaction is already active.";
          if (error.status === 409 && (serverMessage === "Transaction changed on another device" || error.payload?.type === "transaction_conflict"))
            return "This transaction was modified on another device. Review the conflict before choosing which version to keep.";
          if (error.status === 409 && serverMessage === "Transaction was deleted on another device")
            return "This transaction was deleted on another device. Resolve the conflict before editing or deleting it again.";
          if (error.status === 409 && serverMessage === "Transaction is already active")
            return "This transaction has already been restored and is active.";
          if (error.status === 400 && /^Invalid transaction(?: version| restoration)?$/.test(serverMessage || ""))
            return "Transaction information is invalid. Check the amount, date, and notes, then try again.";
          if (error.status >= 500)
            return "Unable to restore this transaction right now. Please try again when the server is available.";
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
  downloadReports: "Download Reports",
  profile: "Shop Profile",
  settings: "Settings",
  reminders: "Reminder Settings",
  help: "Help & Support",
  subscription: "My Subscription",
  subscriptionPayments: "Payment History",
  referral: "Refer & Earn",
  account: "Account",
  audit: "Activity History",
  deletedTransactions: "Deleted Transactions",
};
const customerDetailsStyles = StyleSheet.create({
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 12,
  },
  headerContent: { gap: 12 },
  balanceCard: { padding: 14, gap: 8, borderRadius: 12 },
  balanceAmount: { fontSize: 27, lineHeight: 34, flexShrink: 1 },
  statCard: { padding: 12, gap: 6, borderRadius: 12, minWidth: 0 },
  statValue: { fontSize: 18, lineHeight: 23, flexShrink: 1 },
  primaryActionGroup: { gap: 12, marginBottom: 4 },
  equalRowButton: { flex: 1 },
  actionGroup: { gap: 12, marginTop: 4 },
  actionButton: {
    alignSelf: "stretch",
    width: "100%",
    minWidth: 0,
    minHeight: 48,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  outlinedActionButton: { borderColor: colors.green },
  actionRow: { flexDirection: "row", gap: 12, alignItems: "stretch" },
  financialRow: { flexDirection: "row", gap: 12, alignItems: "stretch" },
  transactionCard: { padding: 12, gap: 8, borderRadius: 12 },
  transactionAvatar: { width: 36, height: 36, borderRadius: 18 },
  transactionHeading: { marginTop: 8 },
  loadMoreContainer: { alignItems: "stretch", width: "100%", paddingTop: 4 },
  loadMoreButton: { alignSelf: "stretch", width: "100%", minWidth: 0, minHeight: 48, backgroundColor: "#FACC15", borderColor: "#FACC15" },
  statLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryIcon: { width: 18, height: 18, flexShrink: 0 },
  balanceLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  transactionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
});

const statementStyles = StyleSheet.create({
  accountCard: { gap: 12, borderColor: colors.greenBorder, backgroundColor: "#FCFFFD" },
  balanceRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  balanceCell: { flex: 1, minWidth: 135, borderWidth: 1, borderRadius: 10, padding: 12, gap: 5 },
  balanceLabel: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  balanceAmount: { fontSize: 20, lineHeight: 26, fontWeight: "800", flexShrink: 1 },
  balancePosition: { fontSize: 12, fontWeight: "600" },
  sectionCard: { gap: 10 },
  loadMore: { width: "100%", alignSelf: "stretch", minHeight: 48, backgroundColor: "#FACC15", borderColor: "#FACC15" },
});

const khataStyles = StyleSheet.create({
  customerGroup: { gap: 10 },
  customerCard: { padding: 0, overflow: "hidden" },
  customerHeader: { padding: 14, gap: 9, backgroundColor: "#F0FDF4", borderBottomWidth: 1, borderBottomColor: "#DCFCE7", borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  customerHeaderTitle: { color: colors.green, fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: 0.7, textTransform: "uppercase" },
  section: { padding: 14, gap: 10 },
  sectionDivider: { height: 1, marginHorizontal: 14, backgroundColor: colors.border },
  infoRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  customerName: { flexGrow: 1, flexBasis: 100, minWidth: 90, paddingVertical: 2 },
  customerNameText: { color: colors.dark, fontSize: 19, lineHeight: 25, fontWeight: "700", flexShrink: 1 },
  contacts: { flexGrow: 2, flexBasis: 190, minWidth: 180 },
  balanceContent: { gap: 10 },
  balanceRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  balanceColumn: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  balanceLabel: { fontSize: 12, color: colors.muted },
  balanceValue: { fontSize: 18, lineHeight: 24, fontWeight: "700", flexShrink: 1 },
  openingDetails: { gap: 5, borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 },
  openingDetail: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  openingDetailLabel: { flex: 1, minWidth: 0, fontSize: 12, color: colors.muted },
  openingDetailValue: { fontSize: 12, fontWeight: "700", color: colors.dark },
  summaryRow: { paddingVertical: 5 },
  historyHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  historyRows: { paddingHorizontal: 0 },
  loadMoreContainer: { width: "100%", alignItems: "stretch", paddingTop: 4 },
  loadMoreButton: { width: "100%", alignSelf: "stretch", minHeight: 48, backgroundColor: "#FACC15", borderColor: "#FACC15" },
});

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
  const loadAuthenticatedReceiptSnapshot = useCallback(async () => {
    const initialData = dataRef.current;
    const preferredAccountId = offlineAccountRef.current;
    const session = await readOfflineSession().catch((error) => {
      if (currentConnectivity() === "online") return null;
      throw error;
    });
    const shopIdentity = receiptAccountIdentity(initialData.shop.phone || "");
    const requireOfflineSession = currentConnectivity() === "offline";
    // `offlineAccountRef` tracks the local cache handle; the authenticated shop is authoritative.
    const accountId = resolveReceiptAccountId(initialData, preferredAccountId, session, requireOfflineSession);
    // Wait for any in-progress local persistence before taking the read-only snapshot.
    await writeQueue.current;
    const authenticatedData = dataRef.current;
    if (receiptAccountIdentity(authenticatedData.shop.phone || "") !== shopIdentity)
      throw new Error("The account session changed. Reopen the transaction.");
    authorizeReceiptAccess(authenticatedData, accountId, session, requireOfflineSession);
    const allowMissingOfflineSession = currentConnectivity() === "online";
    return readReceiptSnapshot(accountId, { authenticatedData, allowMissingOfflineSession });
  }, []);
  const loadTransactionReceipt = useCallback(async (entryId: string) =>
    buildTransactionReceipt(await loadAuthenticatedReceiptSnapshot(), entryId), [loadAuthenticatedReceiptSnapshot]);
  const loadCustomerAccountStatement = useCallback(async (customerId: string) =>
    buildCustomerAccountStatement(await loadAuthenticatedReceiptSnapshot(), customerId), [loadAuthenticatedReceiptSnapshot]);
  const loadMonthlyKhataStatement = useCallback(async (customerId: string, selectedMonth: string, transactionFilter: string, customerSearch: string, customerCreatedDateFilter: string) =>
    buildMonthlyKhataStatement(await loadAuthenticatedReceiptSnapshot(), customerId, selectedMonth, new Date(), transactionFilter, customerSearch, customerCreatedDateFilter), [loadAuthenticatedReceiptSnapshot]);
  const loadDownloadReport = useCallback(async (request: { kind: DownloadReportKind; customerId: string | null; fromDate?: string; toDate?: string }) =>
    buildDownloadReport(await loadAuthenticatedReceiptSnapshot(), request), [loadAuthenticatedReceiptSnapshot]);
  const [route, setRoute] = useState<Route>({ screen: "welcome" });
  const [history, setHistory] = useState<Route[]>([]);
  const [search, setSearch] = useState("");
  const [deletedDateFilter, setDeletedDateFilter] = useState("");
  const [filter, setFilter] = useState("All");
  const [customerListSort, setCustomerListSort] = useState<HomeCustomerSort>("date-desc");
  const [customerCreationDateFilter, setCustomerCreationDateFilter] = useState("");
  const [khataCustomerSort, setKhataCustomerSort] = useState<HomeCustomerSort>("date-desc");
  const [khataCustomerDateFilter, setKhataCustomerDateFilter] = useState("");
  const [khataDatePickerVisible, setKhataDatePickerVisible] = useState(false);
  const [khataDatePickerMonth, setKhataDatePickerMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [customerDatePickerVisible, setCustomerDatePickerVisible] = useState(false);
  const [customerDatePickerMonth, setCustomerDatePickerMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [manageCustomerFilter, setManageCustomerFilter] = useState("All");
  const customerActionGate = useRef(new CustomerActionGate());
  const [savingCustomers, setSavingCustomers] = useState<Record<string, CustomerLifecycleState>>({});
  const [customerPagePending, startCustomerPageTransition] = useTransition();
  const customerPageRequest = useRef<{ key: string; count: number } | null>(null);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [reportCustomerId, setReportCustomerId] = useState<string | null>(null);
  const [reportCustomerSearch, setReportCustomerSearch] = useState("");
  const [reportKind, setReportKind] = useState<DownloadReportKind>("all");
  const [reportKindPickerVisible, setReportKindPickerVisible] = useState(false);
  const [reportPreview, setReportPreview] = useState<DownloadReport | null>(null);
  const [reportPreviewLoading, setReportPreviewLoading] = useState(false);
  const [reportPreviewError, setReportPreviewError] = useState(false);
  const [reportVisibleCount, setReportVisibleCount] = useState(DOWNLOAD_REPORT_PAGE_SIZE);
  const reportPreviewRequest = useRef(0);
  const [reportFromDate, setReportFromDate] = useState("");
  const [reportToDate, setReportToDate] = useState("");
  const [reportDatePicker, setReportDatePicker] = useState<"from" | "to" | "">("");
  useEffect(() => {
    if (route.screen === "downloadReports") {
      setReportCustomerId(null);
      setReportCustomerSearch("");
      setReportKind("all");
      setReportKindPickerVisible(false);
      setReportPreview(null);
      setReportVisibleCount(DOWNLOAD_REPORT_PAGE_SIZE);
      setReportFromDate("");
      setReportToDate("");
      setReportDatePicker("");
    }
  }, [route.screen]);
  useEffect(() => {
    if (route.screen !== "downloadReports") return;
    const requestId = ++reportPreviewRequest.current;
    setReportVisibleCount(DOWNLOAD_REPORT_PAGE_SIZE);
    setReportPreview(null);
    setReportPreviewError(false);
    const customDateState = reportKind === "custom" ? customReportDateState(reportFromDate, reportToDate) : "valid";
    if (customDateState !== "valid") {
      setReportPreviewLoading(false);
      return;
    }
    setReportPreviewLoading(true);
    void loadDownloadReport({ kind: reportKind, customerId: reportCustomerId,
      ...(reportKind === "custom" ? { fromDate: reportFromDate, toDate: reportToDate } : {}) })
      .then((report) => {
        if (reportPreviewRequest.current === requestId) setReportPreview(report);
      })
      .catch(() => {
        if (reportPreviewRequest.current === requestId) setReportPreviewError(true);
      })
      .finally(() => {
        if (reportPreviewRequest.current === requestId) setReportPreviewLoading(false);
      });
    return () => { if (reportPreviewRequest.current === requestId) reportPreviewRequest.current += 1; };
  }, [route.screen, reportKind, reportCustomerId, reportFromDate, reportToDate, data, loadDownloadReport]);
  const customerFinancialById = useMemo(
    () => new Map(data.customers.map((item) => [item.id, financialSummary(data, item.id)] as const)),
    [data],
  );
  const matchingCustomers = useMemo(() => {
    if (route.screen === "customers") {
      const query = search.trim().toLocaleLowerCase();
      return data.customers
        .filter((c) => {
          if (!isActiveCustomer(c)) return false;
          const createdDate = (c.createdAt || "").slice(0, 10);
          const searchMatches = !query || [c.name, c.phone, c.address, createdDate].some((value) => value.toLocaleLowerCase().includes(query));
          const dateMatches = !customerCreationDateFilter || createdDate === customerCreationDateFilter;
          // Keep dues filtering aligned with the exact balance shown in each customer row.
          const currentBalance = balance(data, c.id);
          const summary = customerFinancialById.get(c.id);
          const categoryMatches = filter === "All"
            || (filter === "Outstanding Dues" && currentBalance > 0)
            || (filter === "No Dues" && currentBalance <= 0)
            || (filter === "Total Udhari" && (summary?.totalUdhariPaise || 0) > 0)
            || (filter === "Total Money Received" && (summary?.totalReceivedPaise || 0) > 0)
            || (filter === "Udhari Recovered" && (summary?.totalUdhariRecoveredPaise || 0) > 0)
            || (filter === "Available Advances" && (summary?.availableAdvancePaise || 0) > 0)
            || (filter === "Advance Deposited" && (summary?.totalAdvanceDepositedPaise || 0) > 0)
            || (filter === "Advance Refunded" && (summary?.totalAdvanceRefundedPaise || 0) > 0);
          return searchMatches && dateMatches && categoryMatches;
        })
        .slice()
        .sort((left, right) => customerListSort === "date-desc" || customerListSort === "date-asc"
          ? (customerListSort === "date-desc"
              ? (right.createdAt || "").localeCompare(left.createdAt || "")
              : (left.createdAt || "").localeCompare(right.createdAt || "")) || left.id.localeCompare(right.id)
          : customerListSort === "name-asc"
            ? left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id)
            : right.name.localeCompare(left.name, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id));
    }
    if (["credit", "payment", "refund"].includes(route.screen))
      return data.customers.filter((c) => isActiveCustomer(c) && (c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)));
    return [];
  }, [data, route.screen, search, filter, customerListSort, customerCreationDateFilter, customerFinancialById]);
  const managedCustomers = useMemo(() => data.customers.filter((c) => {
    const tabMatches = matchesCustomerLifecycleFilter(c, manageCustomerFilter as "All" | "Disabled" | "Removed");
    return tabMatches && (c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search));
  }), [data.customers, search, manageCustomerFilter]);
  const matchingKhataCustomers = useMemo(() => {
    if (route.screen !== "khata") return [];
    const query = search.trim().toLocaleLowerCase();
    return data.customers
      .filter((customer) => {
        const createdDate = (customer.createdAt || "").slice(0, 10);
        const searchMatches = !query || [customer.name, customer.phone, customer.address, createdDate]
          .some((value) => value.toLocaleLowerCase().includes(query));
        return searchMatches && (!khataCustomerDateFilter || createdDate === khataCustomerDateFilter);
      })
      .slice()
      .sort((left, right) => khataCustomerSort === "date-desc" || khataCustomerSort === "date-asc"
        ? (khataCustomerSort === "date-desc"
            ? (right.createdAt || "").localeCompare(left.createdAt || "")
            : (left.createdAt || "").localeCompare(right.createdAt || "")) || left.id.localeCompare(right.id)
        : khataCustomerSort === "name-asc"
          ? left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id)
          : right.name.localeCompare(left.name, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id));
  }, [data.customers, route.screen, search, khataCustomerDateFilter, khataCustomerSort]);
  const khataRows = useMemo(() => {
    if (route.screen !== "khata") return [];
    return matchingKhataCustomers.map((customer) => {
      const summary = monthly(data, customer.id, month);
      const entries = khataEntriesForTab(summary.entries, filter, month);
      return { customer, summary, entries };
    });
  }, [data, route.screen, filter, month, matchingKhataCustomers]);
  const [listPage, setListPage] = useState({ key: "", count: PAGE_SIZE, loading: false });
  const [customerHistoryPage, setCustomerHistoryPage] = useState({ customerId: "", visibleCount: 10 });
  const [statementHistoryPage, setStatementHistoryPage] = useState({ key: "", visibleCount: 10 });
  const listPageRef = useRef({ key: "", count: PAGE_SIZE, total: 0, loading: false });
  const listPageCounts = useRef(new Map<string, number>());
  const listScrollOffsets = useRef(new Map<string, number>());
  const restoredListKey = useRef("");
  const virtualListRef = useRef<FlatList<any> | null>(null);
  const listHasScrolled = useRef(false);
  const customerScrollGate = useRef(new UserScrollPageGate());
  const customerScrollStartedForKey = useRef("");
  const customerDragStartOffset = useRef(0);
  const listPageKey = `${route.screen}:${route.id || ""}:${search}:${filter}:${manageCustomerFilter}:${month}:${route.screen === "customers" ? `${customerListSort}:${customerCreationDateFilter}` : route.screen === "khata" ? `${khataCustomerSort}:${khataCustomerDateFilter}` : route.screen === "deletedTransactions" ? deletedDateFilter : ""}`;
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
    if (route.screen === "customer" || route.screen === "viewCustomer")
      setCustomerHistoryPage({ customerId: route.id || "", visibleCount: 10 });
  }, [route.screen, route.id]);
  useEffect(() => {
    if (route.screen === "statement")
      setStatementHistoryPage({ key: `${route.id || ""}:${month}`, visibleCount: 10 });
  }, [route.screen, route.id, month]);
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
    if (route.screen === "customer" || route.screen === "customers" || route.screen === "manageCustomers" || route.screen === "khata" || route.screen === "statement" || !listHasScrolled.current || !nearBottom || current.key !== listPageKeyRef.current || current.loading || current.count >= current.total) return;
    requestNextVisiblePage();
  };
  const requestNextVisiblePage = () => {
    const current = listPageRef.current;
    if (route.screen === "customer" || route.screen === "khata" || route.screen === "statement" || !listHasScrolled.current || current.key !== listPageKeyRef.current || current.loading || current.count >= current.total) return;
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
  const [transactionDateTimeEdited, setTransactionDateTimeEdited] = useState(false);
  const [dateTimePickerVisible, setDateTimePickerVisible] = useState(false);
  const [dateTimePickerDate, setDateTimePickerDate] = useState("");
  const [dateTimePickerTime, setDateTimePickerTime] = useState("");
  const [dateTimePickerMonth, setDateTimePickerMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [homeRecentLimit, setHomeRecentLimit] = useState(10);
  const [khataCustomerTransactionLimits, setKhataCustomerTransactionLimits] = useState<Record<string, number>>({});
  useEffect(() => {
    setKhataCustomerTransactionLimits({});
  }, [month, data.shop.phone]);
  const [homeCustomerListLimits, setHomeCustomerListLimits] = useState<Record<HomeCustomerListKey, number>>({
    outstanding: 10, udhari: 10, received: 10, recovered: 10,
    availableAdvance: 10, deposited: 10, refunded: 10, customers: 10,
  });
  const [homeRecentSort, setHomeRecentSort] = useState<"date-desc" | "date-asc" | "name-asc" | "name-desc">("date-desc");
  const [homeRecentSearch, setHomeRecentSearch] = useState("");
  const [homeRecentFilterDate, setHomeRecentFilterDate] = useState("");
  const [homeRecentDatePickerVisible, setHomeRecentDatePickerVisible] = useState(false);
  const [homeRecentDatePickerMonth, setHomeRecentDatePickerMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [homeCustomerListFilters, setHomeCustomerListFilters] = useState<Record<HomeCustomerListKey, { search: string; date: string; sort: HomeCustomerSort }>>({
    outstanding: { search: "", date: "", sort: "date-desc" },
    udhari: { search: "", date: "", sort: "date-desc" },
    received: { search: "", date: "", sort: "date-desc" },
    recovered: { search: "", date: "", sort: "date-desc" },
    availableAdvance: { search: "", date: "", sort: "date-desc" },
    deposited: { search: "", date: "", sort: "date-desc" },
    refunded: { search: "", date: "", sort: "date-desc" },
    customers: { search: "", date: "", sort: "date-desc" },
  });
  const [homeRecentDatePickerTarget, setHomeRecentDatePickerTarget] = useState<"recent" | HomeCustomerListKey>("recent");
  const updateHomeCustomerFilter = (key: HomeCustomerListKey, patch: Partial<{ search: string; date: string; sort: HomeCustomerSort }>) => {
    setHomeCustomerListFilters((previous) => ({ ...previous, [key]: { ...previous[key], ...patch } }));
    if (patch.search !== undefined || patch.date !== undefined)
      setHomeCustomerListLimits((previous) => ({ ...previous, [key]: 10 }));
  };
  const [referralCodeFromLink, setReferralCodeFromLink] = useState("");
  const [referralSnapshot, setReferralSnapshot] = useState<api.ReferralWalletSnapshot | null>(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const [referralLoadError, setReferralLoadError] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpHint, setOtpHint] = useState<{ key: string; parameters?: Record<string, string | number> } | null>(null);
  const [otpVerified, setOtpVerified] = useState(false);
  const [notices, setNotices] = useState<{id:string;title:string;body:string;read:boolean;date:string}[]>([]);
  const [seconds, setSeconds] = useState(30);
  const [busy, setBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatusState | { kind: "loading" }>({ kind: "loading" });
  const [connectivityStatus, setConnectivityStatus] = useState<ConnectivityStatus>("checking");
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState<number | null>(null);
  const [networkDiagnosticsVisible, setNetworkDiagnosticsVisible] = useState(false);
  const [networkDiagnosticsRetrying, setNetworkDiagnosticsRetrying] = useState(false);
  const [storageRetrying, setStorageRetrying] = useState(false);
  const [, setNetworkDiagnosticsRevision] = useState(0);
  const networkDiagnostics = currentConnectivityDetails();
  const networkBuildInfo = connectivityBuildInfo();
  useEffect(() => {
    api.setServerClockObserver(setServerClockOffsetMs);
    return () => api.setServerClockObserver(null);
  }, []);
  useEffect(() => {
    const acceptUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        const candidate = parsed.searchParams.get("ref") || parsed.pathname.match(/\/refer\/([A-Fa-f0-9]{10})/)?.[1] ||
          (parsed.hostname === "refer" ? parsed.pathname.match(/^\/([A-Fa-f0-9]{10})$/)?.[1] : null);
        if (!candidate || !/^[A-Fa-f0-9]{10}$/.test(candidate)) return;
        const code = candidate.toUpperCase();
        setReferralCodeFromLink(code);
        setForm((current) => ({ ...current, referralCode: current.referralCode || code }));
      } catch { /* Ignore unrelated or malformed deep links. */ }
    };
    void Linking.getInitialURL().then(acceptUrl).catch(() => {});
    const listener = Linking.addEventListener("url", ({ url }) => acceptUrl(url));
    return () => listener.remove();
  }, []);
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
      void refreshSyncStatus();
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
  const [useWalletForPurchase, setUseWalletForPurchase] = useState(false);
  const [subscriptionPaymentLoading, setSubscriptionPaymentLoading] = useState(false);
  const subscriptionPaymentLock = useRef(false);
  const pendingPaymentCheck = useRef<string | null>(null);
  const reconnectSyncLock = useRef(false);
  async function refreshSyncStatus(accountId = offlineAccountRef.current) {
    const current = dataRef.current;
    if (!current.signedIn) {
      setSyncStatus(syncStatusUnavailable("not_signed_in"));
      return;
    }
    const authenticatedShopId = accountKey(current.shop.phone || "");
    if (!authenticatedShopId) {
      setSyncStatus(syncStatusUnavailable("shop_context"));
      return;
    }
    if (!offlineStorageAvailable()) {
      setSyncStatus(syncStatusUnavailable("storage"));
      return;
    }
    if (!accountId || accountId !== authenticatedShopId) {
      setSyncStatus(syncStatusUnavailable("shop_context"));
      return;
    }
    try {
      const counts = await readSyncQueueStatus(accountId);
      // An async queue read may finish after a logout or account switch. Never
      // display another account's status in the current shop's Settings.
      if (offlineAccountRef.current !== accountId || accountKey(dataRef.current.shop.phone || "") !== accountId) return;
      setSyncStatus(syncStatusFromQueue(counts, {
        offline: currentConnectivity() === "offline",
        syncing: isAccountSynchronizing(accountId),
      }));
    } catch {
      if (offlineAccountRef.current === accountId && accountKey(dataRef.current.shop.phone || "") === accountId)
        setSyncStatus(syncStatusUnavailable("read"));
    }
  }
  async function refreshSubscriptionInfo(
    accountId = offlineAccountRef.current,
    promptPermission = false,
  ): Promise<boolean> {
    if (!accountId) return false;
    if (route.screen === "subscription" || route.screen === "subscriptionPayments")
      setSubscriptionLoading(true);
    try {
      if ((await checkConnectivity()) !== "online")
        throw new api.ApiTransportError("network");
      const snapshot = await api.getSubscriptionSnapshot();
      const pendingKey = `dk.subscription.pending.${accountId}`;
      const pendingRaw = await SecureStore.getItemAsync(pendingKey).catch(() => null);
      let verifiedPendingOrderId: string | null = null;
      if (pendingRaw) {
        try {
          const pending = JSON.parse(pendingRaw) as { orderId?: string; idempotencyKey?: string; planCode?: string; months?: number; shopId?: string };
          if (pending.shopId && pending.shopId !== snapshot.current.shopId) {
            pendingPaymentCheck.current = null;
          } else if (pending.orderId || pending.idempotencyKey) {
            const checkKey = `${accountId}:${pending.orderId || pending.idempotencyKey}`;
            if (pendingPaymentCheck.current !== checkKey) {
              pendingPaymentCheck.current = checkKey;
              let status: Awaited<ReturnType<typeof api.getSubscriptionPaymentStatus>> | null = null;
              if (pending.orderId) {
                status = await api.getSubscriptionPaymentStatus(pending.orderId);
              } else if (
                pending.idempotencyKey &&
                (pending.planCode === "pro" || pending.planCode === "business") &&
                Number.isSafeInteger(pending.months) &&
                Number(pending.months) > 0
              ) {
                status = await api.getSubscriptionPaymentAttemptStatus(pending.idempotencyKey);
                pending.orderId = status.id;
                pending.shopId = snapshot.current.shopId;
                await SecureStore.setItemAsync(pendingKey, JSON.stringify(pending));
              }
              if (!status) {
                pendingPaymentCheck.current = null;
              } else if (status.status === "paid") {
                const fresh = await api.getSubscriptionSnapshot();
                snapshot.current = fresh.current;
                snapshot.history = fresh.history;
                snapshot.payments = fresh.payments;
                snapshot.historyNextCursor = fresh.historyNextCursor;
                snapshot.paymentsNextCursor = fresh.paymentsNextCursor;
                snapshot.plans = fresh.plans;
                verifiedPendingOrderId = pending.orderId ?? null;
              } else if (status.status === "failed") {
                await SecureStore.deleteItemAsync(pendingKey).catch(() => undefined);
              } else pendingPaymentCheck.current = null;
            }
          } else pendingPaymentCheck.current = null;
        } catch {
          pendingPaymentCheck.current = null;
          /* Keep a pending attempt so the next online refresh can reconcile it. */
        }
      } else pendingPaymentCheck.current = null;
      try {
        const cached = await readSubscriptionSnapshot(accountId);
        const boundShopId = await SecureStore.getItemAsync(subscriptionShopBindingKey(accountId)).catch(() => null);
        if (
          cached && typeof cached === "object" && "history" in cached && "payments" in cached &&
          boundShopId === snapshot.current.shopId &&
          (cached as SubscriptionSnapshot).current?.shopId === snapshot.current.shopId
        ) {
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
      snapshot.entitlementLastVerifiedAt = snapshot.current.verifiedAt;
      setSubscriptionSnapshot(snapshot);
      setSubscriptionLoadError("");
      let cacheSaved = false;
      if (offlineStorageAvailable()) {
        cacheSaved = await cacheSubscriptionSnapshot(accountId, snapshot).catch(() => false);
        if (cacheSaved) {
          try {
            await SecureStore.setItemAsync(subscriptionShopBindingKey(accountId), snapshot.current.shopId);
            await markSubscriptionClock(accountId, snapshot.current.shopId);
          } catch {
            cacheSaved = false;
          }
        }
      }
      if (verifiedPendingOrderId && cacheSaved)
        await SecureStore.deleteItemAsync(pendingKey).catch(() => undefined);
      else if (verifiedPendingOrderId)
        pendingPaymentCheck.current = null;
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
      return cacheSaved;
    } catch (problem) {
      let cached: unknown = null;
      try { cached = await readSubscriptionSnapshot(accountId); } catch { cached = null; }
      if (cached && typeof cached === "object" && "current" in cached && "plans" in cached) {
        const snapshot = cached as SubscriptionSnapshot;
        const boundShopId = await SecureStore.getItemAsync(subscriptionShopBindingKey(accountId)).catch(() => null);
        if (boundShopId && boundShopId === snapshot.current?.shopId) {
          const expiresAt = snapshot.current.expiresAt ? Date.parse(snapshot.current.expiresAt) : null;
          const clockSafe = await isOfflineSubscriptionClockSafe(
            accountId,
            snapshot.current.shopId,
            Number((snapshot as SubscriptionSnapshot).cachedAt),
          );
          if (expiresAt !== null && Number.isFinite(expiresAt)) {
            const remaining = Math.max(0, expiresAt - Date.now());
            snapshot.current.remainingMilliseconds = remaining;
            snapshot.current.remainingDays = Math.ceil(remaining / 86400000);
            snapshot.current.remainingHours = Math.ceil(remaining / 3600000);
            snapshot.current.offlineExpired = !isOfflineEntitlementUsable({ now: Date.now(), expiresAt, clockSafe });
          } else if (snapshot.current.expiresAt) {
            snapshot.current.remainingMilliseconds = 0;
            snapshot.current.remainingDays = 0;
            snapshot.current.remainingHours = 0;
            snapshot.current.offlineExpired = true;
          } else {
            snapshot.current.offlineExpired = !isOfflineEntitlementUsable({ now: Date.now(), expiresAt: null, clockSafe });
          }
          setSubscriptionSnapshot(snapshot);
          setSubscriptionLoadError("");
          try {
            const reminders = await scheduleSubscriptionNotifications(snapshot, accountId, false, dataRef.current.language);
            snapshot.notificationsGranted = reminders.granted;
            snapshot.localNotificationIds = reminders.identifiers;
          } catch { snapshot.notificationsGranted = false; }
        } else {
          setSubscriptionLoadError("Subscription details must be verified online for this shop.");
        }
      } else {
        setSubscriptionLoadError(errorMessage(problem, "Subscription information is unavailable."));
      }
      return false;
    } finally {
      if (route.screen === "subscription" || route.screen === "subscriptionPayments")
        setSubscriptionLoading(false);
    }
  }
  async function purchaseSubscription(acceptedPricingVersionOverride?: number) {
    const accountId = offlineAccountRef.current;
    const selected = subscriptionSnapshot?.plans.find((item) => item.name === plan || item.code === plan.toLowerCase());
    const selectedMonths = Number(subscriptionDuration);
    const months = selected?.durations.some((item) => item.months === selectedMonths)
      ? selectedMonths
      : selected?.durations[0]?.months ?? 0;
    const checkoutPrice = selected?.durations.find((item) => item.months === months);
    const availableWalletMinor = referralSnapshot && subscriptionSnapshot?.current.shopId && referralSnapshot.shopId === subscriptionSnapshot.current.shopId
      ? referralSnapshot.wallet.availableMinor : 0;
    const canPayFullyFromWallet = useWalletForPurchase && !!checkoutPrice && availableWalletMinor >= checkoutPrice.finalAmountMinor;
    if (subscriptionPaymentLock.current) return;
    if (!accountId || !selected || selected.code === "free") {
      Alert.alert("Choose a paid plan", "The Free plan is already available without checkout.");
      return;
    }
    if (!subscriptionSnapshot?.checkoutEnabled) {
      Alert.alert("Payments unavailable", "Cashfree checkout is not enabled for this app build.");
      return;
    }
    const currentShopId = subscriptionSnapshot.current.shopId;
    if (!currentShopId) {
      Alert.alert("Subscription unavailable", "Refresh your subscription details before starting a payment.");
      return;
    }
    if (isExpoGo && !canPayFullyFromWallet) {
      Alert.alert("Development build required", "Cashfree uses native payment modules and cannot run in Expo Go. Install an Android or iOS development build first.");
      return;
    }
    if ((await checkConnectivity(true)) !== "online") {
      Alert.alert("Internet required", "Internet connection required to purchase or renew your subscription. Your existing offline records remain available.");
      return;
    }
    subscriptionPaymentLock.current = true;
    setSubscriptionPaymentLoading(true);
    const pendingKey = `dk.subscription.pending.${accountId}`;
    const acceptedPricingVersion = acceptedPricingVersionOverride ?? selected.pricingVersion;
    let pending: { idempotencyKey?: string; orderId?: string; planCode?: string; months?: number; shopId?: string; pricingVersion?: number; useWallet?: boolean } | null = null;
    let orderId: string | undefined;
    try {
      const raw = await SecureStore.getItemAsync(pendingKey);
      if (raw) {
        try { pending = JSON.parse(raw); } catch { pending = null; }
      }
      if (pending?.shopId && pending.shopId !== currentShopId) {
        Alert.alert("Payment pending verification", "This payment belongs to another shop. Sign in to that shop to verify it before starting another payment.");
        return;
      }
      if (pending?.orderId && pending.planCode === selected.code && pending.months === months && (pending.useWallet === true) === useWalletForPurchase) {
        orderId = pending.orderId;
        const status = await api.getSubscriptionPaymentStatus(orderId);
        if (status.status === "paid") {
          const refreshed = await refreshSubscriptionInfo(accountId);
          if (refreshed) {
            await SecureStore.deleteItemAsync(pendingKey).catch(() => undefined);
            Alert.alert("Subscription active", status.walletAppliedMinor ? "The wallet payment was verified and the subscription is active." : "Cashfree confirmed your payment and the subscription is active.");
          } else {
            Alert.alert("Payment pending verification", "Cashfree confirmed payment. The app will refresh the subscription entitlement when the connection is available.");
          }
          return;
        }
        if (status.status === "failed") {
          await SecureStore.deleteItemAsync(pendingKey);
          pending = null;
          orderId = undefined;
        }
      } else if (pending && (pending.planCode !== selected.code || pending.months !== months || (pending.useWallet === true) !== useWalletForPurchase)) {
        Alert.alert("Payment still processing", "Finish or verify the existing subscription payment before starting another one.");
        return;
      }
      const idempotencyKey = pending?.idempotencyKey || Crypto.randomUUID();
      if (!pending?.idempotencyKey) {
        pending = { idempotencyKey, planCode: selected.code, months, shopId: currentShopId, pricingVersion: acceptedPricingVersion, useWallet: useWalletForPurchase };
      }
      pending = { ...pending, idempotencyKey, planCode: selected.code, months, shopId: currentShopId, pricingVersion: acceptedPricingVersion, useWallet: useWalletForPurchase };
      await SecureStore.setItemAsync(pendingKey, JSON.stringify(pending));
      const checkout = await api.createSubscriptionCheckout({
        planCode: selected.code as "pro" | "business",
        durationMonths: months,
        acceptedPricingVersion,
        idempotencyKey,
        useWallet: useWalletForPurchase,
      });
      orderId = checkout.orderId;
      pending = { idempotencyKey, planCode: selected.code, months, orderId, shopId: currentShopId, useWallet: useWalletForPurchase };
      await SecureStore.setItemAsync(pendingKey, JSON.stringify(pending));
      if (checkout.status === "paid" && checkout.amountMinor === 0) {
        const refreshed = await refreshSubscriptionInfo(accountId);
        if (refreshed) {
          await SecureStore.deleteItemAsync(pendingKey).catch(() => undefined);
          await api.getReferralWalletSnapshot().then(setReferralSnapshot).catch(() => undefined);
          Alert.alert("Subscription active", "Your wallet payment was applied and the subscription is active.");
        } else Alert.alert("Payment applied", "Wallet payment was accepted. Refresh subscription details when connected to update this device.");
        return;
      }
      try {
        await launchCashfreeCheckout({
          paymentSessionId: checkout.paymentSessionId,
          gatewayOrderId: checkout.gatewayOrderId,
          environment: checkout.checkoutEnvironment,
        });
      } catch { /* Cancellation, callback loss and native errors are reconciled below. */ }
      if (!orderId) throw new Error("Payment order is unavailable for verification.");
      const status = await api.verifySubscriptionPayment({ orderId });
      if (status.status === "paid") {
        const refreshed = await refreshSubscriptionInfo(accountId);
        if (refreshed) {
          await SecureStore.deleteItemAsync(pendingKey).catch(() => undefined);
          Alert.alert("Subscription active", checkout.walletAppliedMinor ? "Your wallet contribution and verified Cashfree payment activated the subscription." : "Cashfree confirmed your payment and the subscription is active.");
        } else {
          Alert.alert("Payment pending verification", "Cashfree confirmed payment. The app will refresh the subscription entitlement when the connection is available.");
        }
      } else if (status.status === "failed") {
        await SecureStore.deleteItemAsync(pendingKey);
        Alert.alert("Payment not completed", "Cashfree did not confirm a successful payment. You can try again.");
      } else {
        Alert.alert("Payment processing", "The payment is not confirmed yet. Your subscription will update after Cashfree verification. Use Refresh in Subscription & Billing to check again.");
      }
    } catch (problem) {
      const changedPricing = problem instanceof api.ApiError &&
        problem.payload?.code === "SUBSCRIPTION_PRICE_CHANGED" &&
        problem.payload?.currentPricing;
      if (changedPricing) {
        const updated = problem.payload.currentPricing as {
          planName: string;
          months: number;
          pricingVersion: number;
          basePriceMinor: number;
          discountPercent: number;
          discountAmountMinor: number;
          taxableAmountMinor: number;
          taxPercent: number;
          taxAmountMinor: number;
          finalAmountMinor: number;
        };
        await refreshSubscriptionInfo(accountId);
        const details = `${updated.planName} · ${updated.months} months\nBase: ${money(updated.basePriceMinor / 100)}\nDiscount (${updated.discountPercent}%): −${money(updated.discountAmountMinor / 100)}\nSubtotal: ${money(updated.taxableAmountMinor / 100)}\nTax (${updated.taxPercent}%): +${money(updated.taxAmountMinor / 100)}\nTotal payable: ${money(updated.finalAmountMinor / 100)}`;
        Alert.alert(
          "Plan price changed",
          `${details}\n\nReview and accept this amount before continuing to Cashfree.`,
          [
            { text: "Cancel", style: "cancel", onPress: () => {
              if (!pending?.orderId) void SecureStore.deleteItemAsync(pendingKey).catch(() => undefined);
            } },
            { text: "Accept and continue", onPress: () => void purchaseSubscription(updated.pricingVersion) },
          ],
        );
        return;
      }
      if (orderId) {
        try {
          const status = await api.getSubscriptionPaymentStatus(orderId);
          if (status.status === "paid") {
            const refreshed = await refreshSubscriptionInfo(accountId);
            if (refreshed) {
              await SecureStore.deleteItemAsync(pendingKey).catch(() => undefined);
              Alert.alert("Subscription active", status.walletAppliedMinor ? "Your wallet contribution and verified Cashfree payment activated the subscription." : "Cashfree confirmed your payment and the subscription is active.");
            } else {
              Alert.alert("Payment pending verification", "Cashfree confirmed payment. The app will refresh the subscription entitlement when the connection is available.");
            }
            return;
          }
        } catch { /* Preserve the idempotent attempt for an online retry. */ }
      }
      if ((orderId || pending?.idempotencyKey) && (await checkConnectivity().catch(() => "offline")) !== "online") {
        Alert.alert("Payment pending verification", "Your payment reference is saved securely. We’ll check its status when the connection returns. No new order was created.");
      } else {
        Alert.alert("Unable to complete payment", errorMessage(problem, "A payment is activated only after server verification."));
      }
    } finally {
      subscriptionPaymentLock.current = false;
      setSubscriptionPaymentLoading(false);
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
    if (problem instanceof api.ApiError && problem.payload?.code === "INVALID_TRANSACTION_RESTORATION")
      Alert.alert(
        "Restore needs attention",
        `${errorMessage(problem, "Invalid restore request.")} The change remains on this phone and will not retry automatically. Refresh Deleted Transactions or review sync status in Settings.`,
      );
    else if (problem instanceof api.ApiError && [401, 403, 404].includes(problem.status))
      Alert.alert(
        problem.status === 401 ? "Sign-in required" : problem.status === 403 ? "Not authorized" : "Transaction unavailable",
        `${errorMessage(problem, "The server rejected this change.")} Your local change remains saved; review sync status in Settings.`,
      );
    else if (key === "permanent")
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
              await refreshSubscriptionInfo(id, false);
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
    if (route.screen !== "referral" || !data.signedIn || data.shopExists === false) return;
    let live = true;
    setReferralSnapshot(null);
    if (connectivityStatus === "offline") {
      setReferralLoading(false);
      setReferralLoadError("Internet connection is required to refresh referral status and wallet balance. Existing offline records remain available.");
      return () => { live = false; };
    }
    setReferralLoading(true);
    setReferralLoadError("");
    void api.getReferralWalletSnapshot().then((snapshot) => {
      if (live) setReferralSnapshot(snapshot);
    }).catch((problem) => {
      if (live) setReferralLoadError(errorMessage(problem, "Unable to load referral and wallet information."));
    }).finally(() => {
      if (live) setReferralLoading(false);
    });
    return () => { live = false; };
  }, [route.screen, data.signedIn, data.shopExists, data.shop.phone, connectivityStatus]);
  useEffect(() => {
    const id = offlineAccountRef.current;
    if (!data.signedIn || !id || !offlineStorageAvailable()) return;
    let live = true;
    let online = false;
    const runSync = () => {
      if (reconnectSyncLock.current) return;
      reconnectSyncLock.current = true;
      const revision = localRevision.current;
      void (async () => {
        // This authenticated API request refreshes/validates the server session,
        // updates the shop-bound entitlement cache, and reconciles any pending
        // Cashfree attempt before the durable offline queue is replayed.
        await refreshSubscriptionInfo(id, false);
        if (!live || offlineAccountRef.current !== id) return;
        return synchronizeAccount(id);
      })()
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
        .finally(() => {
          reconnectSyncLock.current = false;
          if (live) void promptNextConflict(id);
        });
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
  }, [data.signedIn, data.shop.phone, route.screen, connectivityStatus]);
  useEffect(() => subscribeSyncState((accountId) => {
    if (accountId === offlineAccountRef.current) void refreshSyncStatus(accountId);
  }), []);
  useEffect(() => {
    const id = offlineAccountRef.current;
    if (!data.signedIn || !id || !["subscription", "subscriptionPayments"].includes(route.screen)) return;
    void refreshSubscriptionInfo(id, route.screen === "subscription");
    if (connectivityStatus !== "offline")
      void api.getReferralWalletSnapshot().then(setReferralSnapshot).catch(() => undefined);
  }, [data.signedIn, data.shop.phone, route.screen, connectivityStatus]);
  useEffect(() => {
    if (data.signedIn) return;
    subscriptionAccountRef.current = null;
    setSubscriptionSnapshot(null);
    setSubscriptionLoadError("");
    setReferralSnapshot(null);
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
  function commit(next: Data, previousOverride?: Data, recordedAtAuthority?: "server"): Promise<boolean> {
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
          if (accountId) {
            await cancelSubscriptionNotifications(accountId);
            await clearOfflineSubscriptionState(accountId).catch(() => undefined);
            await Promise.all([
              SecureStore.deleteItemAsync(subscriptionShopBindingKey(accountId)),
              SecureStore.deleteItemAsync(subscriptionClockAnchorKey(accountId)),
            ]).catch(() => undefined);
          }
          offlineAccountRef.current = null;
          persistedRef.current = null;
        } else if (persisted?.signedIn) {
          const accountId = offlineAccountRef.current;
          if (accountId && offlineStorageAvailable()) {
            const operationId = await saveLocalChange(
              accountId,
              previous,
              next,
              currentConnectivity() === "online" ? recordedAtAuthority : undefined,
            );
            if (operationId === null) {
              if ((await checkConnectivity(true)) !== "online")
                throw new Error("OFFLINE_ENCRYPTED_STORAGE_UNAVAILABLE");
              await api.syncChange(persisted, next, recordedAtAuthority);
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
          await api.syncChange(persisted, next, recordedAtAuthority);
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
  async function save(next: Data, done: () => void, recordedAtAuthority?: "server") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (await commit(next, undefined, recordedAtAuthority)) done();
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
        ...(form.referralCode?.trim() || referralCodeFromLink
          ? { referralCode: String(form.referralCode || referralCodeFromLink).trim().toUpperCase() }
          : {}),
      }));
      if (!registered.shopExists)
        throw new Error("Shop registration could not be confirmed. Please retry.");
      setReferralCodeFromLink("");
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
      await refreshSubscriptionInfo(accountId, false);
      await synchronizeAccount(accountId);
      const status = await readSyncQueueStatus(accountId);
      setSyncStatus(syncStatusFromQueue(status, {
        offline: currentConnectivity() === "offline",
        syncing: isAccountSynchronizing(accountId),
      }));
      if (status.failed || status.conflicts || status.mobileConflicts || status.pending)
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
      `${money(entry.amount)} ${entryLabel(entry.type)} · ${name || "customer"} · ${entryDateTime(entry, localeTag(dataRef.current.language))}${entry.note ? ` · ${entry.note}` : ""}`;
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
        await completeConflict(accountId, conflict, result.entry, result.serverVersion, result.resolutionVersion, result.audit, result.deletedEntry);
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
  function transactionDefaultValues() {
    const now = Date.now() + (
      currentConnectivity() === "online" && serverClockOffsetMs !== null
        ? serverClockOffsetMs
        : 0
    );
    const date = new Date(now);
    return {
      date: date.toLocaleDateString("en-CA"),
      time: formatClockTime(date),
    };
  }
  function openDateTimePicker() {
    const defaults = transactionDefaultValues();
    const selectedDate = validDate(form.date) ? form.date : defaults.date;
    const parsedDate = new Date(`${selectedDate}T12:00:00`);
    setDateTimePickerDate(selectedDate);
    setDateTimePickerMonth(new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1));
    setDateTimePickerTime(parseClockTime(form.time || "") ? form.time : defaults.time);
    setDateTimePickerVisible(true);
  }
  function shiftDateTimePickerMonth(amount: number) {
    setDateTimePickerMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }
  function adjustDateTimePicker(fieldName: "hour" | "minute" | "period", amount: number) {
    const current = parseClockTime(dateTimePickerTime) || parseClockTime(formatClockTime(new Date()))!;
    const next = { ...current };
    if (fieldName === "hour") next.hour = ((current.hour - 1 + amount + 12) % 12) + 1;
    else if (fieldName === "minute") next.minute = (current.minute + amount + 60) % 60;
    else next.period = current.period === "AM" ? "PM" : "AM";
    setDateTimePickerTime(`${next.hour}:${String(next.minute).padStart(2, "0")} ${next.period}`);
  }
  function go(screen: Screen, id?: string, reset = false) {
    setHistory(reset ? [] : [...history, route]);
    setRoute({ screen, id });
    setSearch("");
    setDeletedDateFilter("");
    setFilter("All");
    setFaq("");
    if (screen === "customerForm") {
      const c = data.customers.find((x) => x.id === id);
      setForm(
        c
          ? {
              name: c.name,
              phone: c.phone,
              whatsappNumber: c.whatsappNumber || "",
              sameAsMobile: "false",
              address: c.address,
              opening: String(c.opening),
              openingAdvance: String(c.openingAdvance || 0),
              limit: String(c.limit),
              reminder: String(c.reminder),
            }
          : {
              name: "",
              phone: "",
              whatsappNumber: "",
              sameAsMobile: "false",
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
      setTransactionDateTimeEdited(false);
      const e =
        screen === "editTransaction"
          ? data.entries.find((x) => x.id === id)
          : undefined;
      const defaults = transactionDefaultValues();
      const existingTimestamp = e?.recordedAt || e?.createdAt;
      setForm({
        customerId:
          e?.customerId ||
          id ||
          (screen === "credit" ? "" : data.customers[0]?.id) ||
          "",
        amount: e ? String(e.amount) : "",
        date: e?.date || defaults.date,
        time: existingTimestamp && Number.isFinite(Date.parse(existingTimestamp))
          ? formatClockTime(new Date(existingTimestamp))
          : defaults.time,
        recordedAt: e?.recordedAt || "",
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
      referralCode: data.shopExists === false ? referralCodeFromLink : "",
    });
    if (screen === "share" && id) setForm({ message: statementText(id) });
    if (screen === "statement" && id) {
      const createdAt = data.customers.find((c) => c.id === id)?.createdAt;
      const earliestMonth = createdAt ? monthForDate(createdAt) : undefined;
      if (earliestMonth && month < earliestMonth) setMonth(earliestMonth);
      else if (month > today().slice(0, 7)) setMonth(today().slice(0, 7));
    }
  }
  const f = (key: string, value: string) => {
    if (key === "date" || key === "time") setTransactionDateTimeEdited(true);
    setForm((prev) => route.screen === "customerForm"
      ? updateCustomerContactForm(prev, key, value)
      : { ...prev, [key]: value });
  };
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
  const stat = (label: string, value: string, tone: FinancialTone = "neutral", compact = false, icon?: React.ComponentProps<typeof Icon>["name"]) => {
    const palette = financialPalette[tone];
    return (
      <Card style={[{ flex: 1, backgroundColor: palette.background, borderColor: palette.border }, compact && customerDetailsStyles.statCard]}>
        {icon ? (
          <View style={customerDetailsStyles.statLabelRow}>
            <Icon name={icon} color={palette.text} size={18} style={customerDetailsStyles.summaryIcon} />
            <Text style={[s.statLabel, { flex: 1 }]}>{label}</Text>
          </View>
        ) : <Text style={s.statLabel}>{label}</Text>}
        <Text style={[s.stat, { color: palette.text }, compact && customerDetailsStyles.statValue]}>{value}</Text>
      </Card>
    );
  };
  const actions = (id?: string, compact = false) => {
    if (id && !isActiveCustomer(data.customers.find((item) => item.id === id) || {})) return null;
    const buttonStyle = compact ? customerDetailsStyles.actionButton : undefined;
    const equalRowButtonStyle = [buttonStyle, customerDetailsStyles.equalRowButton];
    const actionContent = (
      <>
        <View style={compact ? customerDetailsStyles.actionRow : s.split}>
          <View style={{ flex: 1 }}>
            <Button style={equalRowButtonStyle} icon="arrow-up-outline" title="+ Give Udhari" danger onPress={() => go("credit", id)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button style={equalRowButtonStyle} icon="arrow-down-outline" title="Receive Money / Add Advance" onPress={() => go("payment", id)} />
          </View>
        </View>
        {id && balance(data, id) < 0 && (
          <Button style={buttonStyle} icon="refresh-outline" title="Refund Advance (एडवांस वापस करें)" orange onPress={() => go("refund", id)} />
        )}
      </>
    );
    return compact ? <View style={customerDetailsStyles.primaryActionGroup}>{actionContent}</View> : actionContent;
  };
  const clockReminder = deviceClockNeedsWarning(serverClockOffsetMs) ? (
    <Card style={{ padding: 12, backgroundColor: colors.amberBg, borderColor: colors.amberBorder }}>
      <Row
        icon="time-outline"
        title={t("Phone date/time differs from server.", data.language)}
        subtitle={t("Check automatic date and time for accurate timestamps. You can continue using Digital-Khata offline.", data.language)}
        color={colors.orange}
      />
    </Card>
  ) : null;
  const customerRow = (c: Customer, includeCreatedTime = false, rightValue?: { text: string; tone: FinancialTone }) => {
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
              {includeCreatedTime
                ? c.createdAt && formatCustomerCreatedAt(c.createdAt) !== "Not available"
                  ? <View style={{ alignSelf: "flex-start", marginTop: 4, marginBottom: 2, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: colors.greenBg }}><Text style={{ fontSize: 10, color: colors.green, fontWeight: "600" }}>{t("Khata Created On", data.language)}: {formatCustomerCreatedAt(c.createdAt)}</Text></View>
                  : null
                : <View style={{ alignSelf: "flex-start", marginTop: 4, marginBottom: 2, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: colors.greenBg }}><Text style={{ fontSize: 10, color: colors.green, fontWeight: "600" }}>{t("Khata Created On", data.language)}: {formatCustomerCreatedOn(c.createdAt)}</Text></View>}
              <CustomerContactInfo customer={c} compact />
            </View>
            <Text style={{ color: financialPalette[rightValue?.tone || tone].text, fontWeight: "700" }}>
              {rightValue?.text || label}
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
            <CustomerContactInfo customer={c} compact />
          </View>
          <View style={[s.badge, { backgroundColor: state === "removed" ? colors.redBg : state === "disabled" ? colors.neutralBg : colors.greenBg }]}>
            <Text style={{ color: state === "removed" ? colors.red : state === "disabled" ? colors.neutral : colors.green, fontWeight: "700" }}>
              {state === "active" ? t("Active", data.language) : t(state === "disabled" ? "Disabled" : "Removed", data.language)}
            </Text>
          </View>
        </View>
        <Text style={{ color: financialPalette[tone].text, fontWeight: "700", marginTop: 8 }}>{label}</Text>
        <View style={[s.split, { marginTop: 8 }]}>
          <View style={{ flex: 1 }}><Button style={customerDetailsStyles.equalRowButton} icon="person-outline" title={t("View Customer", data.language)} secondary onPress={() => go("customer", c.id)} /></View>
          <View style={{ flex: 1 }}><Button style={customerDetailsStyles.equalRowButton} icon="document-text-outline" title="Statement" secondary onPress={() => go("statement", c.id)} /></View>
        </View>
        {state === "active" ? (
          <>
            <View style={s.split}>
              <View style={{ flex: 1 }}><Button style={customerDetailsStyles.equalRowButton} icon="create-outline" title="Edit Customer" disabled={Boolean(saving)} secondary onPress={() => go("customerForm", c.id)} /></View>
              <View style={{ flex: 1 }}><Button style={customerDetailsStyles.equalRowButton} icon="person-remove-outline" title="Disable Customer" loading={saving === "disabled"} disabled={Boolean(saving)} secondary onPress={() => changeCustomerLifecycle(c, "disabled")} /></View>
            </View>
            <Button icon="trash-outline" title="Remove Customer" loading={saving === "removed"} disabled={Boolean(saving)} danger onPress={() => changeCustomerLifecycle(c, "removed")} />
          </>
        ) : state === "disabled" ? (
          <View style={s.split}>
            <View style={{ flex: 1 }}><Button style={customerDetailsStyles.equalRowButton} icon="person-add-outline" title="Enable Customer" loading={saving === "active"} disabled={Boolean(saving)} onPress={() => changeCustomerLifecycle(c, "active")} /></View>
            <View style={{ flex: 1 }}><Button style={customerDetailsStyles.equalRowButton} icon="trash-outline" title="Remove Customer" loading={saving === "removed"} disabled={Boolean(saving)} danger onPress={() => changeCustomerLifecycle(c, "removed")} /></View>
          </View>
        ) : (
          <Button icon="refresh-outline" title="Restore Customer" loading={saving === "active"} disabled={Boolean(saving)} onPress={() => changeCustomerLifecycle(c, "active")} />
        )}
      </Card>
    );
  };
  const entryRow = (e: Entry, compact = false, showHomeCustomerDetails = false, showNote = false) => {
    const customer = data.customers.find((item) => item.id === e.customerId);
    return (
      <Pressable
        key={e.id}
        accessibilityRole="button"
        onPress={() => go("transaction", e.id)}
      >
        <Card style={compact ? customerDetailsStyles.transactionCard : undefined}>
          <View style={[s.split, { alignItems: "center" }]}>
            <View style={compact ? [s.avatar, customerDetailsStyles.transactionAvatar] : s.avatar}>
              <Icon
                name={
                  e.type === "credit"
                    ? "arrow-up-outline"
                    : e.type === "refund"
                      ? "refresh-outline"
                      : "arrow-down-outline"
                }
                size={20}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.rowTitle}>{customer?.name || "Customer"}</Text>
              {showHomeCustomerDetails
                ? <TransactionTypeBadge label={entryLabel(e.type)} compact />
                : <Text style={s.small}>{entryLabel(e.type)}</Text>}
              {showHomeCustomerDetails ? (
                <View style={{ gap: 3, marginTop: 4 }}>
                  {customer ? <CustomerContactInfo customer={customer} compact /> : null}
                  <Text style={s.small}>Created on: {entryDateTime(e, localeTag(data.language))}</Text>
                </View>
              ) : (
                <View style={{ gap: 2 }}>
                  <Text style={s.small}>{entryDateTime(e, localeTag(data.language))}</Text>
                  {showNote && e.note?.trim() ? <Text style={s.small}>{e.note.trim()}</Text> : null}
                </View>
              )}
            </View>
            <Text
              style={{
                fontWeight: "700",
                color: financialPalette[e.type === "credit" ? "red" : e.type === "refund" ? "amber" : "green"].text,
                flexShrink: 0,
              }}
            >
              {transactionAmountText(e, money)}
            </Text>
          </View>
        </Card>
      </Pressable>
    );
  };
  async function saveCustomer() {
    const editing = data.customers.find((item) => item.id === route.id);
    if (editing && !isActiveCustomer(editing))
      return Alert.alert("Cannot edit this customer", "Enable or restore this customer before editing.");
    const name = form.name?.trim();
    const normalizedPhone = normalizeCustomerMobile(form.phone);
    const whatsappNumber = normalizeCustomerMobile(form.whatsappNumber);
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
    if (whatsappNumber === null)
      return Alert.alert("Invalid WhatsApp number", "Enter a 10-digit Indian WhatsApp mobile number beginning with 6–9, or leave it empty.");
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
      whatsappNumber: whatsappNumber || "",
      address: form.address.trim(),
      opening: Math.round(opening * 100) / 100,
      openingAdvance: Math.round(openingAdvance * 100) / 100,
      limit: Math.round(limit * 100) / 100,
      reminder: form.reminder === "true",
      status: existingCustomer?.status ?? true,
      disabled: existingCustomer?.disabled ?? false,
      removed: existingCustomer?.removed ?? false,
    };
    const cachedCurrent = subscriptionSnapshot?.current;
    const online = await checkConnectivity() === "online";
    const clockSafe = online || Boolean(
      cachedCurrent?.shopId && offlineAccountRef.current &&
      await isOfflineSubscriptionClockSafe(
        offlineAccountRef.current,
        cachedCurrent.shopId,
        subscriptionSnapshot?.cachedAt,
      ),
    );
    const expiration = cachedCurrent?.expiresAt ? Date.parse(cachedCurrent.expiresAt) : null;
    const isExpiredOfflineEntitlement = Boolean(
      cachedCurrent?.offlineExpired || !isOfflineEntitlementUsable({
        now: Date.now(),
        expiresAt: expiration,
        clockSafe,
      }),
    );
    const entitlement = isExpiredOfflineEntitlement
      ? subscriptionSnapshot?.plans.find((item) => item.code === "free") || {
          name: "Free",
          customerLimit: 50,
          unlimitedCustomers: false,
        }
      : cachedCurrent?.plan;
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
    if (route.screen === "editTransaction" && !old)
      return Alert.alert("Transaction unavailable", "This transaction is no longer available in the active ledger. Refresh the account before editing it.");
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
    const selectedRecordedAt = localDateTimeIso(form.date, form.time || "");
    if (!selectedRecordedAt)
      return Alert.alert("Invalid time", "Enter a valid time in h:mm AM/PM format, such as 3:45 PM.");
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
      resolutionVersion: old?.resolutionVersion,
      customerId: c.id,
      type,
      amount: Math.round(amount * 100) / 100,
      date: form.date,
      createdAt: old?.createdAt,
      recordedAt: old && !transactionDateTimeEdited
        ? old.recordedAt || old.createdAt
        : selectedRecordedAt,
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
    const useServerTimestamp = !old && !transactionDateTimeEdited && currentConnectivity() === "online";
    const apply = () => save(next, () => go("customer", c.id, true), useServerTimestamp ? "server" : undefined);
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
    const customerName = dataRef.current.customers.find((item) => item.id === e.customerId)?.name || "Customer";
    const type = entryLabel(e.type);
    const originalDate = entryDateTime(e, localeTag(dataRef.current.language));
    Alert.alert(
      "Delete Transaction?",
      `Transaction: ${type}\nAmount: ${money(e.amount)}\nDate: ${originalDate}\nCustomer: ${customerName}\n\nThis transaction will be removed from active financial records and the customer's balances will be recalculated. You can restore it later from Deleted Transactions.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Transaction",
          style: "destructive",
          onPress: () => {
            if (lock.current) return;
            const current = dataRef.current;
            const active = current.entries.find((item) => item.id === e.id);
            if (!active) return Alert.alert("Transaction unavailable", "This transaction is no longer active.");
            const deletedAt = new Date().toISOString();
            save({
              ...current,
              entries: current.entries.filter((item) => item.id !== e.id),
              deletedEntries: [{ ...active, deletedAt }, ...(current.deletedEntries || []).filter((item) => item.id !== active.id)],
              audit: [{ id: uid(), action: "Deleted transaction", date: deletedAt, before: active }, ...current.audit],
            }, () => go("customer", active.customerId, true));
          },
        },
      ],
    );
  }
  function restoreEntry(deleted: NonNullable<Data["deletedEntries"]>[number]) {
    if (lock.current) return;
    const customerName = dataRef.current.customers.find((item) => item.id === deleted.customerId)?.name || "Customer";
    Alert.alert(
      "Restore Transaction?",
      `Transaction: ${entryLabel(deleted.type)}\nAmount: ${money(deleted.amount)}\nOriginal Date: ${entryDateTime(deleted, localeTag(dataRef.current.language))}\nCustomer: ${customerName}\n\nRestoring this transaction will add it back to the customer's active financial history and recalculate the outstanding balance and available advance.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Restore Transaction", onPress: () => {
          if (lock.current) return;
          const current = dataRef.current;
          const tombstone = current.deletedEntries?.find((item) => item.id === deleted.id);
          if (!tombstone || current.entries.some((item) => item.id === deleted.id))
            return Alert.alert("Transaction unavailable", "This transaction is no longer in Deleted Transactions.");
          const { deletedAt: _deletedAt, ...restored } = tombstone;
          const restoredAt = new Date().toISOString();
          const event = { id: uid(), action: "Restored transaction", date: restoredAt, before: restored, after: restored };
          save({
            ...current,
            entries: [restored, ...current.entries],
            deletedEntries: (current.deletedEntries || []).filter((item) => item.id !== tombstone.id),
            audit: [event, ...current.audit],
          }, () => Alert.alert("Transaction restored", "Restored on this device. Synchronization will update the shop when available."));
        } },
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
        "Customer,Type,Amount,Date & Time,Description,Method",
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
            entryDateTime(e, localeTag(data.language)),
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
    if (!customer) return;
    const number = normalizeCustomerMobile(channel === "WhatsApp" ? customer.whatsappNumber : customer.phone);
    if (!number)
      return Alert.alert(
        channel === "WhatsApp" ? "WhatsApp number required" : "Phone number required",
        "Edit the customer and add a valid number first.",
      );
    if (!customer.reminder)
      return Alert.alert(
        "Customer opted out",
        "This customer has disabled WhatsApp/SMS reminders.",
      );
    if (channel === "WhatsApp") {
      await openCustomerContact("whatsapp", customer.whatsappNumber, form.message);
      return;
    }
    try {
      await Linking.openURL(`sms:+91${number}?body=${encodeURIComponent(form.message)}`);
    } catch {
      Alert.alert("Unable to open app", "Please install or enable SMS.");
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
          <Button icon="log-in-outline" title="Login" onPress={() => go("login")} />
          <Button
            icon="person-add-outline"
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
            icon="arrow-forward-outline"
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
            icon={otpVerified ? "arrow-forward-outline" : "shield-checkmark-outline"}
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
                  await refreshSubscriptionInfo(id, false);
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
            icon="call-outline"
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
          {data.shopExists === false ? field("Referral code (optional)", "referralCode", {
            autoCapitalize: "characters",
            maxLength: 10,
            placeholder: "Enter a friend’s referral code",
          }) : null}
          <Title>Language</Title>
          <LanguagePicker value={data.language} onChange={selectLanguage} />
          <Button
            icon="checkmark-outline"
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
      {
      const compareNames = (left: string, right: string, direction: "name-asc" | "name-desc") =>
        direction === "name-asc"
          ? left.localeCompare(right, undefined, { sensitivity: "base" })
          : right.localeCompare(left, undefined, { sensitivity: "base" });
      const transactionCreatedAt = (entry: Entry) => entry.createdAt || entry.recordedAt || `${entry.date}T00:00:00.000Z`;
      const currentMonthName = new Intl.DateTimeFormat(localeTag(data.language), { month: "long" }).format(new Date());
      const customerNames = new Map(data.customers.map((customer) => [customer.id, customer.name]));
      const homeRecentTransactions = data.entries
        .filter((entry) => {
          const customer = data.customers.find((item) => item.id === entry.customerId);
          const query = homeRecentSearch.trim().toLocaleLowerCase();
          const createdDate = (entry.createdAt || entry.recordedAt || "").slice(0, 10);
          const queryMatches = !query || [
            customer?.name,
            customer?.phone,
            customer?.address,
            entry.date,
            createdDate,
            entry.reference,
          ].some((value) => value?.toLocaleLowerCase().includes(query));
          return queryMatches && (!homeRecentFilterDate || entry.date === homeRecentFilterDate || createdDate === homeRecentFilterDate);
        })
        .slice()
        .sort((a, b) => homeRecentSort === "date-desc" || homeRecentSort === "date-asc"
          ? (homeRecentSort === "date-desc"
              ? transactionCreatedAt(b).localeCompare(transactionCreatedAt(a))
              : transactionCreatedAt(a).localeCompare(transactionCreatedAt(b))) || a.id.localeCompare(b.id)
          : compareNames(
              customerNames.get(a.customerId) || "",
              customerNames.get(b.customerId) || "",
              homeRecentSort,
            ) || transactionCreatedAt(b).localeCompare(transactionCreatedAt(a)) || a.id.localeCompare(b.id));
      const customerMetricAmount = (customer: Customer, key: Exclude<HomeCustomerListKey, "customers">) => {
        const summary = customerFinancialById.get(customer.id);
        if (!summary) return 0;
        switch (key) {
          case "outstanding": return summary.outstandingPaise;
          case "udhari": return summary.totalUdhariPaise;
          case "received": return summary.totalReceivedPaise;
          case "recovered": return summary.totalUdhariRecoveredPaise;
          case "availableAdvance": return summary.availableAdvancePaise;
          case "deposited": return summary.totalAdvanceDepositedPaise;
          case "refunded": return summary.totalAdvanceRefundedPaise;
        }
      };
      const homeCustomerListDefinitions: { key: HomeCustomerListKey; title: string; tone: FinancialTone }[] = [
        { key: "outstanding", title: "Customers With Outstanding Dues", tone: "red" },
        { key: "udhari", title: "Total Udhari", tone: "blue" },
        { key: "received", title: "Total Money Received", tone: "green" },
        { key: "recovered", title: "Udhari Recovered", tone: "green" },
        { key: "availableAdvance", title: "Available Advances", tone: "green" },
        { key: "deposited", title: "Advance Deposited", tone: "blue" },
        { key: "refunded", title: "Advance Refunded", tone: "amber" },
        { key: "customers", title: "Customers", tone: "neutral" },
      ];
      const homeCustomerLists = Object.fromEntries(homeCustomerListDefinitions.map(({ key }) => {
        const filter = homeCustomerListFilters[key];
        const query = filter.search.trim().toLocaleLowerCase();
        const customers = data.customers
          .filter((customer) => {
            if (!isActiveCustomer(customer)) return false;
            const createdDate = (customer.createdAt || "").slice(0, 10);
            const queryMatches = !query || [customer.name, customer.phone, customer.address, createdDate].some((value) => value.toLocaleLowerCase().includes(query));
            const dateMatches = !filter.date || createdDate === filter.date;
            const metricMatches = key === "customers" || customerMetricAmount(customer, key) > 0;
            return queryMatches && dateMatches && metricMatches;
          })
          .slice()
          .sort((a, b) => filter.sort === "date-desc" || filter.sort === "date-asc"
            ? (filter.sort === "date-desc"
                ? (b.createdAt || "").localeCompare(a.createdAt || "")
                : (a.createdAt || "").localeCompare(b.createdAt || "")) || a.id.localeCompare(b.id)
            : compareNames(a.name, b.name, filter.sort) || (b.createdAt || "").localeCompare(a.createdAt || "") || a.id.localeCompare(b.id));
        return [key, customers];
      })) as Record<HomeCustomerListKey, Customer[]>;
      const homeSortControls = (
        selected: HomeCustomerSort,
        setSelected: (value: HomeCustomerSort) => void,
      ) => (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 4 }}>
          {([
            ["date-desc", "arrow-down-outline", "Date ↓"],
            ["date-asc", "arrow-up-outline", "Date ↑"],
            ["name-asc", "arrow-up-outline", "Name A–Z"],
            ["name-desc", "arrow-down-outline", "Name Z–A"],
          ] as const).map(([value, icon, label]) => {
            const active = selected === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setSelected(value)}
                style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: active ? colors.green : colors.border, backgroundColor: active ? colors.greenBg : "white" }}
              >
                <Icon name={icon} size={15} color={active ? colors.green : colors.muted} />
                <Text style={{ color: active ? colors.green : colors.muted, fontSize: 12, fontWeight: active ? "700" : "500" }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      );
      const animateHomeListExpansion = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      };
      const activeHomeDateFilter = homeRecentDatePickerTarget === "recent"
        ? homeRecentFilterDate
        : homeCustomerListFilters[homeRecentDatePickerTarget].date;
      const setActiveHomeDateFilter = (date: string) => {
        if (homeRecentDatePickerTarget === "recent") {
          setHomeRecentFilterDate(date);
          setHomeRecentLimit(10);
        } else updateHomeCustomerFilter(homeRecentDatePickerTarget, { date });
      };
      const renderHomeCustomerList = (definition: typeof homeCustomerListDefinitions[number]) => {
        const list = homeCustomerLists[definition.key];
        const limit = homeCustomerListLimits[definition.key];
        const filters = homeCustomerListFilters[definition.key];
        return (
          <View key={definition.key} style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name={definition.key === "customers" ? "people-outline" : "wallet-outline"} size={18} color={colors.dark} style={{ width: 18, height: 18, flexShrink: 0 }} />
              <Title>{definition.title}</Title>
            </View>
            {homeSortControls(filters.sort, (sort) => updateHomeCustomerFilter(definition.key, { sort }))}
            <View>
              <TextInput
                accessibilityLabel={`Search ${definition.title.toLowerCase()} by name, mobile number, address or creation date`}
                placeholder="Search name, mobile, address or date"
                placeholderTextColor="#9AA49F"
                value={filters.search}
                onChangeText={(search) => updateHomeCustomerFilter(definition.key, { search })}
                style={[s.input, { paddingRight: 52, minHeight: 48, paddingVertical: 10, marginBottom: 0 }]}
                returnKeyType="search"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={filters.date ? `Choose creation date, currently ${filters.date}` : "Choose creation date"}
                onPress={() => {
                  const initial = filters.date ? new Date(`${filters.date}T12:00:00`) : new Date();
                  setHomeRecentDatePickerTarget(definition.key);
                  setHomeRecentDatePickerMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
                  setHomeRecentDatePickerVisible(true);
                }}
                style={{ position: "absolute", right: 8, top: 5, width: 38, height: 38, alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="calendar-outline" size={20} color={filters.date ? colors.green : colors.muted} />
              </Pressable>
              {filters.date ? (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                  <Text style={s.small}>Created on: {new Date(`${filters.date}T12:00:00`).toLocaleDateString(localeTag(data.language))}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Clear creation date filter" onPress={() => updateHomeCustomerFilter(definition.key, { date: "" })} style={{ padding: 4 }}>
                    <Icon name="close-circle-outline" size={18} color={colors.muted} />
                  </Pressable>
                </View>
              ) : null}
            </View>
            {list.length ? list.slice(0, limit).map((customer) => {
              const rightValue = definition.key === "customers"
                ? undefined
                : { text: money(customerMetricAmount(customer, definition.key) / 100), tone: definition.tone };
              return <React.Fragment key={customer.id}>{customerRow(customer, true, rightValue)}</React.Fragment>;
            }) : <Hint>No customers match these filters.</Hint>}
            {list.length > limit ? (
              <>
                <Hint>{`Showing ${limit} of ${list.length} customers`}</Hint>
                <Button
                  icon="chevron-down-circle-outline"
                  title={t("Load more customers", data.language)}
                  style={{ backgroundColor: "#FACC15", borderColor: "#FACC15" }}
                  onPress={() => {
                    animateHomeListExpansion();
                    setHomeCustomerListLimits((previous) => ({
                      ...previous,
                      [definition.key]: Math.min(previous[definition.key] + 10, list.length),
                    }));
                  }}
                />
              </>
            ) : null}
          </View>
        );
      };
      content = (
        <>
          {clockReminder}
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
            {stat("Current Outstanding", money(financial.outstandingPaise / 100), financial.outstandingPaise > 0 ? "red" : "neutral", true, "wallet-outline")}
            {stat("Total Udhari", money(financial.totalUdhariPaise / 100), "blue", true, "arrow-up-circle-outline")}
          </View>
          <View style={s.split}>
            {stat("Total Money Received", money(financial.totalReceivedPaise / 100), "green", true, "arrow-down-circle-outline")}
            {stat("Udhari Recovered", money(financial.totalUdhariRecoveredPaise / 100), "green", true, "checkmark-circle-outline")}
          </View>
          <View style={s.split}>
            {stat("Available Advances", money(financial.availableAdvancePaise / 100), financial.availableAdvancePaise > 0 ? "green" : "neutral", true, "wallet-outline")}
            {stat("Advance Deposited", money(financial.totalAdvanceDepositedPaise / 100), "blue", true, "cash-outline")}
          </View>
          <View style={s.split}>
            {stat("Advance Refunded", money(financial.totalAdvanceRefundedPaise / 100), "amber", true, "return-down-back-outline")}
            {stat("Customers", String(data.customers.filter(isActiveCustomer).length), "neutral", true, "people-outline")}
          </View>
          <Button
            icon="person-add-outline"
            title="+ Add Customer"
            secondary
            style={{ alignSelf: "stretch", width: "100%" }}
            onPress={() => go("customerForm")}
          />
          <Hint>Current outstanding and advances are balances. The other totals show recorded activity.</Hint>
          {actions()}
          <View style={s.split}>
            {stat(
              `${t("This month’s udhari", data.language)} (${currentMonthName})`,
              money(periodUdhari(data, today().slice(0, 7))),
              "blue",
              true,
              "arrow-up-outline",
            )}
            {stat(
              `${t("This month’s collection", data.language)} (${currentMonthName})`,
              money(periodReceived(data, today().slice(0, 7))),
              "green",
              true,
              "arrow-down-outline",
            )}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="time-outline" size={18} color={colors.dark} style={{ width: 18, height: 18, flexShrink: 0 }} />
            <Title>Recent Transactions</Title>
          </View>
          {homeSortControls(homeRecentSort, setHomeRecentSort)}
          <View>
            <TextInput
              accessibilityLabel="Search recent transactions by customer name, mobile number, address or date"
              placeholder="Search name, mobile, address or date"
              placeholderTextColor="#9AA49F"
              value={homeRecentSearch}
              onChangeText={(value) => {
                setHomeRecentSearch(value);
                setHomeRecentLimit(10);
              }}
              style={[s.input, { paddingRight: 52, minHeight: 48, paddingVertical: 10, marginBottom: 0 }]}
              returnKeyType="search"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={homeRecentFilterDate ? `Choose transaction date, currently ${homeRecentFilterDate}` : "Choose transaction date"}
              onPress={() => {
                const initial = homeRecentFilterDate ? new Date(`${homeRecentFilterDate}T12:00:00`) : new Date();
                setHomeRecentDatePickerTarget("recent");
                setHomeRecentDatePickerMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
                setHomeRecentDatePickerVisible(true);
              }}
              style={{ position: "absolute", right: 8, top: 5, width: 38, height: 38, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name="calendar-outline" size={20} color={homeRecentFilterDate ? colors.green : colors.muted} />
            </Pressable>
            {homeRecentFilterDate ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={s.small}>Transaction date: {new Date(`${homeRecentFilterDate}T12:00:00`).toLocaleDateString(localeTag(data.language))}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Clear transaction date filter" onPress={() => setHomeRecentFilterDate("")} style={{ padding: 4 }}>
                  <Icon name="close-circle-outline" size={18} color={colors.muted} />
                </Pressable>
              </View>
            ) : null}
          </View>
          <Modal
            visible={homeRecentDatePickerVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setHomeRecentDatePickerVisible(false)}
          >
            <View style={{ flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.42)" }}>
              <Card style={{ padding: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <Text style={s.heading}>
                    {homeRecentDatePickerTarget === "recent"
                      ? "Filter by transaction date"
                      : `Filter ${homeCustomerListDefinitions.find((item) => item.key === homeRecentDatePickerTarget)?.title || "customer list"} by creation date`}
                  </Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Close date picker" onPress={() => setHomeRecentDatePickerVisible(false)} style={{ padding: 8 }}>
                    <Icon name="close-outline" size={22} color={colors.dark} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setHomeRecentDatePickerMonth((monthValue) => new Date(monthValue.getFullYear(), monthValue.getMonth() - 1, 1))} style={{ padding: 10 }}>
                    <Icon name="chevron-back-outline" size={20} color={colors.green} />
                  </Pressable>
                  <Text style={s.rowTitle}>{homeRecentDatePickerMonth.toLocaleDateString(localeTag(data.language), { month: "long", year: "numeric" })}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setHomeRecentDatePickerMonth((monthValue) => new Date(monthValue.getFullYear(), monthValue.getMonth() + 1, 1))} style={{ padding: 10 }}>
                    <Icon name="chevron-forward-outline" size={20} color={colors.green} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row" }}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                    <View key={`${day}-${index}`} style={{ flex: 1, alignItems: "center", paddingVertical: 6 }}><Text style={s.small}>{day}</Text></View>
                  ))}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 12 }}>
                  {Array.from({ length: homeRecentDatePickerMonth.getDay() }, (_, index) => <View key={`blank-${index}`} style={{ width: "14.2857%", height: 42 }} />)}
                  {Array.from({ length: new Date(homeRecentDatePickerMonth.getFullYear(), homeRecentDatePickerMonth.getMonth() + 1, 0).getDate() }, (_, index) => {
                    const day = index + 1;
                    const candidate = `${homeRecentDatePickerMonth.getFullYear()}-${String(homeRecentDatePickerMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    return (
                  <Pressable key={candidate} accessibilityRole="button" accessibilityLabel={candidate} accessibilityState={{ selected: candidate === activeHomeDateFilter }} onPress={() => { setActiveHomeDateFilter(candidate); setHomeRecentDatePickerVisible(false); }} style={{ width: "14.2857%", height: 42, alignItems: "center", justifyContent: "center" }}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: candidate === activeHomeDateFilter ? colors.green : "transparent" }}>
                      <Text style={{ color: candidate === activeHomeDateFilter ? "white" : colors.dark, fontWeight: candidate === activeHomeDateFilter ? "700" : "500" }}>{day}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}><Button title="Clear date" secondary onPress={() => { setActiveHomeDateFilter(""); setHomeRecentDatePickerVisible(false); }} /></View>
                  <View style={{ flex: 1 }}><Button title="Cancel" onPress={() => setHomeRecentDatePickerVisible(false)} /></View>
                </View>
              </Card>
            </View>
          </Modal>
          {homeRecentTransactions.length ? (
            homeRecentTransactions
              .slice(0, homeRecentLimit)
              .map((entry) => entryRow(entry, false, true))
          ) : (
            homeRecentSearch.trim() || homeRecentFilterDate
              ? <Empty title="No matching transactions" description="Try another name, address, mobile number or date." />
              : <Empty
                  title="Your khata starts here"
                  description="Add your first customer, then record udhari or a payment."
                />
          )}
          {homeRecentTransactions.length > homeRecentLimit ? (
            <Button
              icon="chevron-down-circle-outline"
              title={t("Load more", data.language)}
              style={{ backgroundColor: "#FACC15", borderColor: "#FACC15" }}
              onPress={() => {
                animateHomeListExpansion();
                setHomeRecentLimit((current) => Math.min(current + 10, homeRecentTransactions.length));
              }}
            />
          ) : null}
          {homeCustomerListDefinitions.map(renderHomeCustomerList)}
        </>
      );
      break;
      }
    case "customers": {
      const list = matchingCustomers;
      const page = pageRecords(list);
      virtualizedRows = {
        data: page.items,
        keyExtractor: (customer) => customer.id,
        renderItem: (customer) => {
          const summary = customerFinancialById.get(customer.id);
          const selectedMetric = filter === "Total Udhari"
            ? { amountPaise: summary?.totalUdhariPaise || 0, tone: "blue" as const }
            : filter === "Total Money Received"
              ? { amountPaise: summary?.totalReceivedPaise || 0, tone: "green" as const }
              : filter === "Udhari Recovered"
                ? { amountPaise: summary?.totalUdhariRecoveredPaise || 0, tone: "green" as const }
                : filter === "Available Advances"
                  ? { amountPaise: summary?.availableAdvancePaise || 0, tone: "green" as const }
                  : filter === "Advance Deposited"
                    ? { amountPaise: summary?.totalAdvanceDepositedPaise || 0, tone: "blue" as const }
                    : filter === "Advance Refunded"
                      ? { amountPaise: summary?.totalAdvanceRefundedPaise || 0, tone: "amber" as const }
                      : null;
          return selectedMetric
            ? customerRow(customer, false, { text: money(selectedMetric.amountPaise / 100), tone: selectedMetric.tone })
            : customerRow(customer);
        },
        header: <>
          <Button
            icon="person-add-outline"
            title="+ Add Customer"
            onPress={() => go("customerForm")}
            style={{ marginTop: 4, marginBottom: 12 }}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4, marginBottom: 4 }}>
            {([
              ["date-desc", "arrow-down-outline", "Date ↓"],
              ["date-asc", "arrow-up-outline", "Date ↑"],
              ["name-asc", "arrow-up-outline", "Name A–Z"],
              ["name-desc", "arrow-down-outline", "Name Z–A"],
            ] as const).map(([value, icon, label]) => {
              const active = customerListSort === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setCustomerListSort(value)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: active ? colors.green : colors.border, backgroundColor: active ? colors.greenBg : "white" }}
                >
                  <Icon name={icon} size={15} color={active ? colors.green : colors.muted} />
                  <Text style={{ color: active ? colors.green : colors.muted, fontSize: 12, fontWeight: active ? "700" : "500" }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View>
            <TextInput
              accessibilityLabel="Search customers by name, mobile number, address or creation date"
              placeholder="Search name, mobile, address or date"
              placeholderTextColor="#9AA49F"
              value={search}
              onChangeText={setSearch}
              style={[s.input, { paddingRight: 52, minHeight: 48, paddingVertical: 10, marginBottom: 0 }]}
              returnKeyType="search"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={customerCreationDateFilter ? `Choose customer creation date, currently ${customerCreationDateFilter}` : "Choose customer creation date"}
              onPress={() => {
                const initial = customerCreationDateFilter ? new Date(`${customerCreationDateFilter}T12:00:00`) : new Date();
                setCustomerDatePickerMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
                setCustomerDatePickerVisible(true);
              }}
              style={{ position: "absolute", right: 8, top: 5, width: 38, height: 38, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name="calendar-outline" size={20} color={customerCreationDateFilter ? colors.green : colors.muted} />
            </Pressable>
            {customerCreationDateFilter ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={s.small}>Created on: {new Date(`${customerCreationDateFilter}T12:00:00`).toLocaleDateString(localeTag(data.language))}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Clear customer creation date filter" onPress={() => setCustomerCreationDateFilter("")} style={{ padding: 4 }}>
                  <Icon name="close-circle-outline" size={18} color={colors.muted} />
                </Pressable>
              </View>
            ) : null}
          </View>
          <Chips
            items={["All", "Outstanding Dues", "No Dues"]}
            value={filter}
            onChange={setFilter}
            equalWidth
            style={{ marginTop: 12, marginBottom: 4 }}
          />
          <Chips
            items={[
              "Total Udhari",
              "Total Money Received",
              "Udhari Recovered",
              "Available Advances",
              "Advance Deposited",
              "Advance Refunded",
            ]}
            value={filter}
            onChange={setFilter}
            style={{ marginTop: 8, marginBottom: 4 }}
          />
          <Modal
            visible={customerDatePickerVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setCustomerDatePickerVisible(false)}
          >
            <View style={{ flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.42)" }}>
              <Card style={{ padding: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <Text style={s.heading}>Filter by customer creation date</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Close date picker" onPress={() => setCustomerDatePickerVisible(false)} style={{ padding: 8 }}>
                    <Icon name="close-outline" size={22} color={colors.dark} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setCustomerDatePickerMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))} style={{ padding: 10 }}>
                    <Icon name="chevron-back-outline" size={20} color={colors.green} />
                  </Pressable>
                  <Text style={s.rowTitle}>{customerDatePickerMonth.toLocaleDateString(localeTag(data.language), { month: "long", year: "numeric" })}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setCustomerDatePickerMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))} style={{ padding: 10 }}>
                    <Icon name="chevron-forward-outline" size={20} color={colors.green} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row" }}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <View key={`${day}-${index}`} style={{ flex: 1, alignItems: "center", paddingVertical: 6 }}><Text style={s.small}>{day}</Text></View>)}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 12 }}>
                  {Array.from({ length: customerDatePickerMonth.getDay() }, (_, index) => <View key={`empty-${index}`} style={{ width: "14.2857%", height: 42 }} />)}
                  {Array.from({ length: new Date(customerDatePickerMonth.getFullYear(), customerDatePickerMonth.getMonth() + 1, 0).getDate() }, (_, index) => {
                    const day = index + 1;
                    const candidate = `${customerDatePickerMonth.getFullYear()}-${String(customerDatePickerMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const selected = candidate === customerCreationDateFilter;
                    return (
                      <Pressable key={candidate} accessibilityRole="button" accessibilityLabel={candidate} accessibilityState={{ selected }} onPress={() => { setCustomerCreationDateFilter(candidate); setCustomerDatePickerVisible(false); }} style={{ width: "14.2857%", height: 42, alignItems: "center", justifyContent: "center" }}>
                        <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: selected ? colors.green : "transparent" }}>
                          <Text style={{ color: selected ? "white" : colors.dark, fontWeight: selected ? "700" : "500" }}>{day}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}><Button title="Clear date" secondary onPress={() => { setCustomerCreationDateFilter(""); setCustomerDatePickerVisible(false); }} /></View>
                  <View style={{ flex: 1 }}><Button title="Cancel" onPress={() => setCustomerDatePickerVisible(false)} /></View>
                </View>
              </Card>
            </View>
          </Modal>
        </>,
        footer: listFooter(page.hasMore, "Loading more customers..."),
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
          {field("WhatsApp Number (Optional)", "whatsappNumber", {
            icon: "logo-whatsapp",
            keyboardType: "phone-pad",
            maxLength: 32,
            placeholder: "98XXXXXXXX",
            editable: form.sameAsMobile !== "true" && (!route.id || isActiveCustomer(customer || {})),
          })}
          <Toggle
            label="Same as Mobile Number"
            value={form.sameAsMobile === "true"}
            onChange={(value) => f("sameAsMobile", String(value))}
            disabled={!!route.id && !isActiveCustomer(customer || {})}
          />
          {field("Address", "address", { placeholder: "Delhi", multiline: true, editable: !route.id || isActiveCustomer(customer || {}) })}
          {route.id && customer ? (
            <Field
              label={t("Khata Created On", data.language)}
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
            icon="checkmark-outline"
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
          .map((entry, index) => ({ entry, index }))
          .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || a.index - b.index)
          .map(({ entry }) => entry);
        const visibleCount = customerHistoryPage.customerId === customer.id ? customerHistoryPage.visibleCount : 10;
        const visibleEntries = visiblePage(entries, visibleCount);
        const historyItems: { id: string; element: React.ReactElement }[] = [];
        if (customer.opening > 0)
          historyItems.push({ id: "opening-udhari", element: <Row icon="book-outline" title="Opening Udhari" subtitle={customer.openingDate || customer.createdAt?.slice(0, 10)} value={money(Math.abs(customer.opening))} color={colors.red} /> });
        if ((customer.openingAdvance || 0) > 0)
          historyItems.push({ id: "opening-advance", element: <Row icon="wallet-outline" title="Opening Advance (जमा राशि)" subtitle={customer.openingDate || customer.createdAt?.slice(0, 10)} value={money(Math.abs(customer.openingAdvance || 0))} color={colors.green} /> });
        if (customer.opening > 0 && (customer.openingAdvance || 0) > 0)
          historyItems.push({ id: "opening-adjustment", element: <Row icon="swap-horizontal-outline" title="Opening Advance Adjusted Against Udhari" subtitle={t("Remaining advance: {{amount}}", data.language, { amount: money(Math.max(0, customer.openingAdvance! - customer.opening)) })} value={money(Math.min(customer.opening, customer.openingAdvance || 0))} color={colors.green} /> });
        historyItems.push(...visibleEntries.items.map((entry) => ({ id: entry.id, element: entryRow(entry, true) })));
        const customerFinancial = financialSummary(data, customer.id);
        const currentOutstandingPaise = customerFinancial.outstandingPaise;
        const availableAdvancePaise = customerFinancial.availableAdvancePaise;
        virtualizedRows = {
          data: historyItems,
          keyExtractor: (item) => item.id,
          renderItem: (item) => item.element,
          header: <View style={customerDetailsStyles.headerContent}>
            <CustomerContactInfo customer={customer} compact />
            <Card style={[customerDetailsStyles.balanceCard, { backgroundColor: financialPalette[currentOutstandingPaise > 0 ? "red" : availableAdvancePaise > 0 ? "green" : "neutral"].background, borderColor: financialPalette[currentOutstandingPaise > 0 ? "red" : availableAdvancePaise > 0 ? "green" : "neutral"].border }]}>
              <View style={customerDetailsStyles.balanceLabelRow}>
                <Icon name="wallet-outline" size={18} style={customerDetailsStyles.summaryIcon} color={financialPalette[currentOutstandingPaise > 0 ? "red" : "neutral"].text} />
                <Hint style={{ color: financialPalette[currentOutstandingPaise > 0 ? "red" : "neutral"].text }}>Current Outstanding</Hint>
              </View>
              <Text style={[s.amount, customerDetailsStyles.balanceAmount, { color: financialPalette[currentOutstandingPaise > 0 ? "red" : "neutral"].text }]}>{money(currentOutstandingPaise / 100)}</Text>
              <Hint style={{ color: financialPalette[availableAdvancePaise > 0 ? "green" : "neutral"].text }}>Available Advance: {money(availableAdvancePaise / 100)}</Hint>
            </Card>
            {customerLifecycleState(customer) === "active" ? actions(customer.id, true) : (
              <View style={[s.badge, { backgroundColor: customerLifecycleState(customer) === "removed" ? colors.redBg : colors.neutralBg }]}>
                <Text style={{ color: customerLifecycleState(customer) === "removed" ? colors.red : colors.neutral, fontWeight: "700" }}>{t(customerLifecycleState(customer) === "removed" ? "Removed" : "Disabled", data.language)}</Text>
              </View>
            )}
            <View style={customerDetailsStyles.financialRow}>
              {stat(
                "Total Udhari",
                money(totalUdhari(data, customer.id)),
                "blue",
                true,
                "arrow-up-circle-outline",
              )}
              {stat(
                "Total Money Received",
                money(customerFinancial.totalReceivedPaise / 100),
                "green",
                true,
                "arrow-down-circle-outline",
              )}
            </View>
            <View style={customerDetailsStyles.financialRow}>
              {stat("Udhari Recovered", money(customerFinancial.totalUdhariRecoveredPaise / 100), "green", true, "checkmark-circle-outline")}
              {stat("Advance Deposited", money(customerFinancial.totalAdvanceDepositedPaise / 100), "blue", true, "cash-outline")}
            </View>
            <View style={customerDetailsStyles.financialRow}>
              {stat("Advance Refunded", money(customerFinancial.totalAdvanceRefundedPaise / 100), "amber", true, "return-down-back-outline")}
              {stat("Available Advance", money(availableAdvancePaise / 100), availableAdvancePaise > 0 ? "green" : "neutral", true, "wallet-outline")}
            </View>
            <View style={customerDetailsStyles.actionGroup}>
              <View style={customerDetailsStyles.actionRow}>
                {customerLifecycleState(customer) === "active" ? <View style={{ flex: 1 }}>
                  <Button style={[customerDetailsStyles.actionButton, customerDetailsStyles.equalRowButton, customerDetailsStyles.outlinedActionButton]} icon="person-outline" title="View Customer" secondary onPress={() => go("viewCustomer", customer.id)} />
                </View> : null}
                <View style={{ flex: 1 }}>
                  <Button style={[customerDetailsStyles.actionButton, customerDetailsStyles.equalRowButton, customerDetailsStyles.outlinedActionButton]} icon="document-text-outline" title="Statement" secondary onPress={() => go("statement", customer.id)} />
                </View>
              </View>
              {customerLifecycleState(customer) === "active" ? <View style={customerDetailsStyles.actionRow}>
                <View style={{ flex: 1 }}>
                  <Button style={[customerDetailsStyles.actionButton, customerDetailsStyles.outlinedActionButton]} icon="create-outline" title="Edit Customer" secondary onPress={() => go("customerForm", customer.id)} />
                </View>
              </View> : null}
            </View>
            <CustomerAccountStatementActions customerId={customer.id} loadStatement={loadCustomerAccountStatement} />
            <View style={customerDetailsStyles.transactionHeading}>
              <View style={customerDetailsStyles.transactionTitleRow}>
                <Icon name="time-outline" size={18} style={customerDetailsStyles.summaryIcon} color={colors.dark} />
                <Title>Transaction History</Title>
              </View>
            </View>
          </View>,
          footer: visibleEntries.hasMore ? <View style={customerDetailsStyles.loadMoreContainer}>
            <Button
              icon="reload-outline"
              title={t("Load More", data.language)}
              style={customerDetailsStyles.loadMoreButton}
              iconColor="#B45309"
              textColor="#92400E"
              onPress={() => setCustomerHistoryPage((previous) => ({
                customerId: customer.id,
                visibleCount: nextVisibleCount(previous.customerId === customer.id ? previous.visibleCount : 10, entries.length, 10),
              }))}
            />
          </View> : null,
          empty: !historyItems.length ? <Empty title="No transactions yet" description="Opening outstanding is included in the outstanding amount." /> : null,
        };
      }
      break;
    case "viewCustomer":
      if (customer) {
        const customerFinancial = financialSummary(data, customer.id);
        const outstandingTone = customerFinancial.outstandingPaise > 0 ? "red" : "neutral";
        const advanceTone = customerFinancial.availableAdvancePaise > 0 ? "green" : "neutral";
        const openingBalanceDisplay = khataBalanceDisplay(customer.opening - (customer.openingAdvance || 0));
        const closingBalanceDisplay = khataBalanceDisplay(balance(data, customer.id));
        const deletedIds = new Set((data.deletedEntries || []).map((deleted) => deleted.id));
        const entries = data.entries
          .filter((candidate) => {
            const record = candidate as Entry & { deletedAt?: string | null; voidedAt?: string | null; status?: string };
            return candidate.customerId === customer.id && !deletedIds.has(candidate.id) &&
              !record.deletedAt && !record.voidedAt && record.status !== "deleted" && record.status !== "voided";
          })
          .map((entry, index) => ({ entry, index }))
          .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || a.index - b.index)
          .map(({ entry }) => entry);
        const visibleCount = customerHistoryPage.customerId === customer.id ? customerHistoryPage.visibleCount : 10;
        const visibleEntries = visiblePage(entries, visibleCount);
        virtualizedRows = {
          data: visibleEntries.items,
          keyExtractor: (item) => item.id,
          renderItem: (item) => entryRow(item, true, false, true),
          header: <View style={customerDetailsStyles.headerContent}>
            <Title>Personal Information</Title>
            <Card>
              <Row icon="person-outline" title="Customer Name" value={customer.name} />
              <CustomerContactInfo customer={customer} detailRows />
              <Row icon="calendar-outline" title={t("Khata Created On", data.language)} value={formatCustomerCreatedOn(customer.createdAt)} />
              <Row title="Credit Limit" value={money(Math.abs(customer.limit || 0))} />
              <Row title="Reminders" value={customer.reminder ? "Allowed" : "Off"} />
            </Card>
            <Title>Financial Information</Title>
            <View style={customerDetailsStyles.financialRow}>
              {stat(t("Opening Balance", data.language), `${money(openingBalanceDisplay.amount)} · ${t(openingBalanceDisplay.position, data.language)}`, openingBalanceDisplay.tone, true, "wallet-outline")}
              {stat(t("Closing Balance", data.language), `${money(closingBalanceDisplay.amount)} · ${t(closingBalanceDisplay.position, data.language)}`, closingBalanceDisplay.tone, true, "wallet-outline")}
            </View>
            <Card>
              <Row icon="arrow-up-outline" title="Opening Udhari" value={money(Math.abs(customer.opening))} color={colors.red} />
              <Row icon="wallet-outline" title="Opening Advance" value={money(Math.abs(customer.openingAdvance || 0))} color={colors.green} />
              {customer.opening > 0 && (customer.openingAdvance || 0) > 0 ? <>
                <Row icon="swap-horizontal-outline" title="Opening Advance Adjusted Against Udhari" value={money(Math.min(customer.opening, customer.openingAdvance || 0))} color={colors.green} />
                <Row icon="wallet-outline" title="Remaining Opening Advance" value={money(Math.max(0, (customer.openingAdvance || 0) - customer.opening))} color={colors.green} />
              </> : null}
              <Row icon="wallet-outline" title="Current Outstanding" value={money(customerFinancial.outstandingPaise / 100)} color={financialPalette[outstandingTone].text} />
              <Row icon="wallet-outline" title="Available Advance" value={money(customerFinancial.availableAdvancePaise / 100)} color={financialPalette[advanceTone].text} />
            </Card>
            <CustomerAccountStatementActions customerId={customer.id} loadStatement={loadCustomerAccountStatement} />
            <View style={customerDetailsStyles.transactionHeading}>
              <View style={customerDetailsStyles.transactionTitleRow}>
                <Icon name="time-outline" size={18} style={customerDetailsStyles.summaryIcon} color={colors.dark} />
                <Title>{t("Transaction History", data.language)}</Title>
              </View>
            </View>
          </View>,
          footer: visibleEntries.hasMore ? <View style={customerDetailsStyles.loadMoreContainer}>
            <Button
              icon="reload-outline"
              title={t("Load More", data.language)}
              style={customerDetailsStyles.loadMoreButton}
              iconColor="#B45309"
              textColor="#92400E"
              onPress={() => setCustomerHistoryPage((previous) => ({
                customerId: customer.id,
                visibleCount: nextVisibleCount(previous.customerId === customer.id ? previous.visibleCount : 10, entries.length, 10),
              }))}
            />
          </View> : null,
          empty: entries.length === 0 ? <Empty title={t("No transactions yet", data.language)} description={t("Opening outstanding is included in the outstanding amount.", data.language)} /> : null,
        };
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
                          <CustomerContactInfo customer={c} compact inverse={form.customerId === c.id} />
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
              {field("Time (h:mm AM/PM) *", "time", {
                placeholder: "3:45 PM",
                autoCapitalize: "characters",
              })}
              <Button
                icon="calendar-outline"
                title="Choose date and time"
                secondary
                onPress={openDateTimePicker}
              />
              {clockReminder}
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
                icon={route.screen === "editTransaction" ? "checkmark-outline" : route.screen === "credit" ? "arrow-up-outline" : route.screen === "refund" ? "refresh-outline" : "arrow-down-outline"}
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
                  icon="trash-outline"
                  title="Delete Transaction"
                  danger
                  onPress={() => deleteEntry(entry)}
                />
              )}
              <Modal
                visible={dateTimePickerVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setDateTimePickerVisible(false)}
              >
                <View style={{ flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.42)" }}>
                  <Card style={{ maxHeight: "92%", padding: 16 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <Text style={s.heading}>Choose date and time</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel="Close date and time picker" onPress={() => setDateTimePickerVisible(false)} style={{ padding: 8 }}>
                        <Icon name="close-outline" size={22} color={colors.dark} />
                      </Pressable>
                    </View>
                    <ScrollView keyboardShouldPersistTaps="handled">
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => shiftDateTimePickerMonth(-1)} style={{ padding: 10 }}>
                          <Icon name="chevron-back-outline" size={20} color={colors.green} />
                        </Pressable>
                        <Text style={s.rowTitle}>{dateTimePickerMonth.toLocaleDateString(localeTag(data.language), { month: "long", year: "numeric" })}</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => shiftDateTimePickerMonth(1)} style={{ padding: 10 }}>
                          <Icon name="chevron-forward-outline" size={20} color={colors.green} />
                        </Pressable>
                      </View>
                      <View style={{ flexDirection: "row" }}>
                        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                          <View key={`${day}-${index}`} style={{ flex: 1, alignItems: "center", paddingVertical: 6 }}>
                            <Text style={s.small}>{day}</Text>
                          </View>
                        ))}
                      </View>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 14 }}>
                        {Array.from({ length: new Date(dateTimePickerMonth.getFullYear(), dateTimePickerMonth.getMonth(), 1).getDay() }, (_, index) => (
                          <View key={`empty-${index}`} style={{ width: "14.2857%", height: 42 }} />
                        ))}
                        {Array.from({ length: new Date(dateTimePickerMonth.getFullYear(), dateTimePickerMonth.getMonth() + 1, 0).getDate() }, (_, index) => {
                          const day = index + 1;
                          const candidate = `${dateTimePickerMonth.getFullYear()}-${String(dateTimePickerMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                          const selected = candidate === dateTimePickerDate;
                          return (
                            <Pressable
                              key={candidate}
                              accessibilityRole="button"
                              accessibilityLabel={candidate}
                              accessibilityState={{ selected }}
                              onPress={() => setDateTimePickerDate(candidate)}
                              style={{ width: "14.2857%", height: 42, alignItems: "center", justifyContent: "center" }}
                            >
                              <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: selected ? colors.green : "transparent" }}>
                                <Text style={{ color: selected ? "white" : colors.dark, fontWeight: selected ? "700" : "500" }}>{day}</Text>
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Text style={s.label}>Time · AM/PM</Text>
                      <Field
                        label="Enter time manually"
                        value={dateTimePickerTime}
                        onChangeText={setDateTimePickerTime}
                        placeholder="3:45 PM"
                        autoCapitalize="characters"
                      />
                      {(() => {
                        const parts = parseClockTime(dateTimePickerTime) || parseClockTime(formatClockTime(new Date()))!;
                        const control = (label: string, value: string, fieldName: "hour" | "minute", amount: number) => (
                          <View style={{ flex: 1, alignItems: "center", gap: 4 }}>
                            <Text style={s.small}>{label}</Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label.toLowerCase()}`} onPress={() => adjustDateTimePicker(fieldName, -amount)} style={{ padding: 9 }}><Icon name="remove-circle-outline" size={20} /></Pressable>
                              <Text style={s.rowTitle}>{value}</Text>
                              <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label.toLowerCase()}`} onPress={() => adjustDateTimePicker(fieldName, amount)} style={{ padding: 9 }}><Icon name="add-circle-outline" size={20} /></Pressable>
                            </View>
                          </View>
                        );
                        return (
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                            {control("Hour", String(parts.hour).padStart(2, "0"), "hour", 1)}
                            {control("Minute", String(parts.minute).padStart(2, "0"), "minute", 1)}
                            <Pressable accessibilityRole="button" accessibilityLabel="Toggle AM or PM" onPress={() => adjustDateTimePicker("period", 1)} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9, backgroundColor: colors.greenBg }}>
                              <Text style={{ color: colors.green, fontWeight: "700" }}>{parts.period}</Text>
                            </Pressable>
                          </View>
                        );
                      })()}
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <View style={{ flex: 1 }}><Button title="Cancel" secondary onPress={() => setDateTimePickerVisible(false)} /></View>
                        <View style={{ flex: 1 }}><Button title="Use date and time" onPress={() => {
                          if (!localDateTimeIso(dateTimePickerDate, dateTimePickerTime)) {
                            Alert.alert("Invalid time", "Enter a valid time in h:mm AM/PM format, such as 3:45 PM.");
                            return;
                          }
                          f("date", dateTimePickerDate);
                          f("time", dateTimePickerTime);
                          setDateTimePickerVisible(false);
                        }} /></View>
                      </View>
                    </ScrollView>
                  </Card>
                </View>
              </Modal>
            </>
          )}
        </>
      );
      break;
    case "transaction":
      {
      const selectedEntry = entry || data.deletedEntries?.find((item) => item.id === route.id);
      if (selectedEntry) {
        const deletedEntry = data.deletedEntries?.find((item) => item.id === selectedEntry.id);
        const transactionCustomer = data.customers.find((customer) => customer.id === selectedEntry.customerId);
        const customerIsActive = !!transactionCustomer && isActiveCustomer(transactionCustomer);
        content = <TransactionDetails
          entry={selectedEntry}
          customer={transactionCustomer || null}
          editable={!deletedEntry && customerIsActive}
          deleted={!!deletedEntry}
          deletedOn={deletedEntry?.deletedAt}
          actionBusy={busy}
          loadReceipt={loadTransactionReceipt}
          onEdit={() => go("editTransaction", selectedEntry.id)}
          onDelete={() => deleteEntry(selectedEntry)}
          onRestore={() => { if (deletedEntry) restoreEntry(deletedEntry); }}
          onViewCustomer={() => { if (transactionCustomer) go("viewCustomer", transactionCustomer.id); }}
        />;
      }
      break;
      }
    case "khata": {
      virtualizedRows = {
        data: khataRows,
        keyExtractor: (group) => group.customer.id,
        renderItem: ({ customer: c, summary: m, entries }) => {
          const accountIdentity = receiptAccountIdentity(data.shop.phone || "");
          const limitKey = `${accountIdentity}:${month}:${filter}:${search.trim()}:${c.id}`;
          const limit = khataCustomerTransactionLimits[limitKey] || 10;
          const visibleEntries = entries.slice(-limit);
          const isActive = isActiveCustomer(c);
          const hasOpeningDetails = c.opening > 0 || (c.openingAdvance || 0) > 0;
          const openingAdvance = c.openingAdvance || 0;
          const openingDisplay = khataBalanceDisplay(m.opening);
          const closingDisplay = khataBalanceDisplay(m.closing);
          return (
            <View style={khataStyles.customerGroup}>
              <Card style={khataStyles.customerCard}>
                <View style={khataStyles.customerHeader}>
                <Text style={khataStyles.customerHeaderTitle}>{t("Personal Information", data.language)}</Text>
                <View style={khataStyles.infoRow}>
                  <Pressable accessibilityRole="button" onPress={() => go("statement", c.id)} style={khataStyles.customerName}>
                    <Text style={khataStyles.customerNameText}>{c.name}</Text>
                    {c.createdAt && formatCustomerCreatedAt(c.createdAt) !== "Not available" ? (
                      <View style={{ alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: colors.greenBg }}>
                        <Text style={{ fontSize: 10, color: colors.green, fontWeight: "600" }}>{t("Khata Created On", data.language)}: {formatCustomerCreatedAt(c.createdAt)}</Text>
                      </View>
                    ) : null}
                    {!isActive ? <View style={[s.badge, { alignSelf: "flex-start", marginTop: 4, backgroundColor: customerLifecycleState(c) === "removed" ? colors.redBg : colors.neutralBg }]}>
                      <Text style={{ color: customerLifecycleState(c) === "removed" ? colors.red : colors.neutral, fontWeight: "700" }}>{t(customerLifecycleState(c) === "removed" ? "Removed" : "Disabled", data.language)}</Text>
                    </View> : null}
                  </Pressable>
                  <View style={khataStyles.contacts}><CustomerContactInfo customer={c} compact /></View>
                </View>
                </View>

                <View style={khataStyles.sectionDivider} />
                <View style={[khataStyles.section, khataStyles.balanceContent]}>
                <Title>{t("Account Balance", data.language)}</Title>
                <View style={khataStyles.balanceRow}>
                  <View style={[khataStyles.balanceColumn, { backgroundColor: financialPalette[openingDisplay.tone].background, borderColor: financialPalette[openingDisplay.tone].border }]}>
                    <Text style={khataStyles.balanceLabel}>{t("Opening Balance", data.language)}</Text>
                    <Text style={[khataStyles.balanceValue, { color: financialPalette[openingDisplay.tone].text }]}>{money(openingDisplay.amount)}</Text>
                    {openingDisplay.position !== "Settled" ? <Text style={khataStyles.balanceLabel}>{t(openingDisplay.position === "Advance" ? "Available Advance" : "Outstanding", data.language)}</Text> : null}
                  </View>
                  <View style={[khataStyles.balanceColumn, { backgroundColor: financialPalette[closingDisplay.tone].background, borderColor: financialPalette[closingDisplay.tone].border }]}>
                    <Text style={khataStyles.balanceLabel}>{t("Closing Balance", data.language)}</Text>
                    <Text style={[khataStyles.balanceValue, { color: financialPalette[closingDisplay.tone].text }]}>{money(closingDisplay.amount)}</Text>
                    {closingDisplay.position !== "Settled" ? <Text style={khataStyles.balanceLabel}>{t(closingDisplay.position === "Advance" ? "Available Advance" : "Outstanding", data.language)}</Text> : null}
                  </View>
                </View>
                {hasOpeningDetails ? <View style={khataStyles.openingDetails}>
                  {c.opening > 0 ? <View style={khataStyles.openingDetail}><Text style={khataStyles.openingDetailLabel}>{t("Opening Udhari", data.language)}</Text><Text style={khataStyles.openingDetailValue}>{money(c.opening)}</Text></View> : null}
                  {openingAdvance > 0 ? <View style={khataStyles.openingDetail}><Text style={khataStyles.openingDetailLabel}>{t("Opening Advance", data.language)}</Text><Text style={khataStyles.openingDetailValue}>{money(openingAdvance)}</Text></View> : null}
                  {c.opening > 0 && openingAdvance > 0 ? <>
                    <View style={khataStyles.openingDetail}><Text style={khataStyles.openingDetailLabel}>{t("Opening Advance Adjusted Against Udhari", data.language)}</Text><Text style={khataStyles.openingDetailValue}>{money(Math.min(c.opening, openingAdvance))}</Text></View>
                    <View style={khataStyles.openingDetail}><Text style={khataStyles.openingDetailLabel}>{t("Remaining advance: {{amount}}", data.language, { amount: money(Math.max(0, openingAdvance - c.opening)) })}</Text></View>
                  </> : null}
                </View> : null}
                <View style={khataStyles.summaryRow}><Row title="Udhari Given" value={money(m.credit)} color={colors.blue} /></View>
                <View style={khataStyles.summaryRow}><Row title="Payment Received" value={money(m.payment)} color={colors.green} /></View>
                {m.refund > 0 ? <View style={khataStyles.summaryRow}><Row title="Advance Refunded" value={money(m.refund)} color={colors.orange} /></View> : null}
                </View>

                <View style={khataStyles.sectionDivider} />
                <View style={khataStyles.section}>
                <View style={khataStyles.historyHeader}>
                  <Icon name="time-outline" size={18} color={colors.dark} />
                  <Title>{t("Transaction History", data.language)}</Title>
                </View>
                <View style={khataStyles.historyRows}>
                  {!entries.length ? <Hint>{t("No transactions in this period", data.language)}</Hint> : null}
                  {visibleEntries.map((entry: Entry) => (
                    <Row
                      key={entry.id}
                      title={entry.note || entryLabel(entry.type)}
                      subtitle={entryDateTime(entry, localeTag(data.language))}
                      value={transactionAmountText(entry, money)}
                      color={financialPalette[entry.type === "credit" ? "red" : entry.type === "refund" ? "amber" : "green"].text}
                      onPress={() => go("transaction", entry.id)}
                    />
                  ))}
                </View>
              {entries.length > limit ? (
                <View style={khataStyles.loadMoreContainer}>
                  <Button
                    icon="chevron-down-circle-outline"
                    title={t("Load more", data.language)}
                    style={khataStyles.loadMoreButton}
                    iconColor="#B45309"
                    textColor="#92400E"
                    onPress={() => setKhataCustomerTransactionLimits((previous) => ({
                      ...previous,
                      [limitKey]: Math.min((previous[limitKey] || 10) + 10, entries.length),
                    }))}
                  />
                </View>
              ) : null}
                </View>

                <View style={khataStyles.sectionDivider} />
                <View style={khataStyles.section}>
                  <MonthlyKhataStatementActions
                    customerId={c.id}
                    month={month}
                    transactionFilter={filter}
                    customerSearch={search}
                    customerCreatedDateFilter={khataCustomerDateFilter}
                    loadStatement={loadMonthlyKhataStatement}
                  />
                </View>
              </Card>
            </View>
          );
        },
        header: <>
          {monthPicker()}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4, marginBottom: 4 }}>
            {([
              ["date-desc", "arrow-down-outline", "Date ↓"],
              ["date-asc", "arrow-up-outline", "Date ↑"],
              ["name-asc", "arrow-up-outline", "Name A–Z"],
              ["name-desc", "arrow-down-outline", "Name Z–A"],
            ] as const).map(([value, icon, label]) => {
              const active = khataCustomerSort === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setKhataCustomerSort(value)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: active ? colors.green : colors.border, backgroundColor: active ? colors.greenBg : "white" }}
                >
                  <Icon name={icon} size={15} color={active ? colors.green : colors.muted} />
                  <Text style={{ color: active ? colors.green : colors.muted, fontSize: 12, fontWeight: active ? "700" : "500" }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View>
            <TextInput
              accessibilityLabel="Search Khata customers by name, mobile number, address or creation date"
              placeholder="Search name, mobile, address or date"
              placeholderTextColor="#9AA49F"
              value={search}
              onChangeText={setSearch}
              style={[s.input, { paddingRight: 52, minHeight: 48, paddingVertical: 10, marginBottom: 0 }]}
              returnKeyType="search"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={khataCustomerDateFilter ? `Choose Khata customer date, currently ${khataCustomerDateFilter}` : "Choose Khata customer date"}
              onPress={() => {
                const initial = khataCustomerDateFilter ? new Date(`${khataCustomerDateFilter}T12:00:00`) : new Date();
                setKhataDatePickerMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
                setKhataDatePickerVisible(true);
              }}
              style={{ position: "absolute", right: 8, top: 5, width: 38, height: 38, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name="calendar-outline" size={20} color={khataCustomerDateFilter ? colors.green : colors.muted} />
            </Pressable>
            {khataCustomerDateFilter ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={s.small}>Khata created on: {new Date(`${khataCustomerDateFilter}T12:00:00`).toLocaleDateString(localeTag(data.language))}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Clear Khata customer date filter" onPress={() => setKhataCustomerDateFilter("")} style={{ padding: 4 }}>
                  <Icon name="close-circle-outline" size={18} color={colors.muted} />
                </Pressable>
              </View>
            ) : null}
          </View>
          <Chips
            items={["All", "Udhari", "Payment"]}
            value={filter}
            onChange={setFilter}
            style={{ marginTop: 14 }}
          />
          <Modal
            visible={khataDatePickerVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setKhataDatePickerVisible(false)}
          >
            <View style={{ flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.42)" }}>
              <Card style={{ padding: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <Text style={s.heading}>Filter by Khata creation date</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Close date picker" onPress={() => setKhataDatePickerVisible(false)} style={{ padding: 8 }}>
                    <Icon name="close-outline" size={22} color={colors.dark} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setKhataDatePickerMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))} style={{ padding: 10 }}>
                    <Icon name="chevron-back-outline" size={20} color={colors.green} />
                  </Pressable>
                  <Text style={s.rowTitle}>{khataDatePickerMonth.toLocaleDateString(localeTag(data.language), { month: "long", year: "numeric" })}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setKhataDatePickerMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))} style={{ padding: 10 }}>
                    <Icon name="chevron-forward-outline" size={20} color={colors.green} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row" }}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <View key={`${day}-${index}`} style={{ flex: 1, alignItems: "center", paddingVertical: 6 }}><Text style={s.small}>{day}</Text></View>)}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 12 }}>
                  {Array.from({ length: khataDatePickerMonth.getDay() }, (_, index) => <View key={`empty-${index}`} style={{ width: "14.2857%", height: 42 }} />)}
                  {Array.from({ length: new Date(khataDatePickerMonth.getFullYear(), khataDatePickerMonth.getMonth() + 1, 0).getDate() }, (_, index) => {
                    const day = index + 1;
                    const candidate = `${khataDatePickerMonth.getFullYear()}-${String(khataDatePickerMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const selected = candidate === khataCustomerDateFilter;
                    return (
                      <Pressable key={candidate} accessibilityRole="button" accessibilityLabel={candidate} accessibilityState={{ selected }} onPress={() => { setKhataCustomerDateFilter(candidate); setKhataDatePickerVisible(false); }} style={{ width: "14.2857%", height: 42, alignItems: "center", justifyContent: "center" }}>
                        <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: selected ? colors.green : "transparent" }}>
                          <Text style={{ color: selected ? "white" : colors.dark, fontWeight: selected ? "700" : "500" }}>{day}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}><Button title="Clear date" secondary onPress={() => { setKhataCustomerDateFilter(""); setKhataDatePickerVisible(false); }} /></View>
                  <View style={{ flex: 1 }}><Button title="Cancel" onPress={() => setKhataDatePickerVisible(false)} /></View>
                </View>
              </Card>
            </View>
          </Modal>
        </>,
        empty: !matchingKhataCustomers.length
          ? <Empty title={data.customers.length ? "No matching customers" : "Your monthly khata"} description={data.customers.length ? "Try another name, mobile number, address or creation date." : "Customer balances will appear here after you add customers."} />
          : <Empty title="No matching transactions" description={t("No {{items}} for this customer search and month.", data.language, { items: t(filter === "All" ? "transactions" : filter === "Udhari" ? "Udhari transactions" : "payments", data.language) })} />,
      };
      break;
    }
    case "statement":
      if (customer) {
        const m = monthly(data, customer.id, month);
        const statementKey = `${customer.id}:${month}`;
        const visibleCount = statementHistoryPage.key === statementKey ? statementHistoryPage.visibleCount : 10;
        const deletedIds = new Set((data.deletedEntries || []).map((deleted) => deleted.id));
        const eligibleEntries = m.entries.filter((entry) => {
          const record = entry as Entry & { deletedAt?: string | null; voidedAt?: string | null; status?: string };
          return !deletedIds.has(entry.id) && !record.deletedAt && !record.voidedAt &&
            record.status !== "deleted" && record.status !== "voided";
        });
        const visibleEntries = visiblePage(eligibleEntries, visibleCount);
        const openingDisplay = khataBalanceDisplay(m.opening);
        const closingDisplay = khataBalanceDisplay(m.closing);
        const balancePositionKey = (position: string) =>
          position === "Advance" ? "Available Advance" : position;
        content = (
          <>
            {monthPicker(
              customer.createdAt ? monthForDate(customer.createdAt) : undefined,
              today().slice(0, 7),
            )}
            <Card style={statementStyles.accountCard}>
              <View style={customerDetailsStyles.transactionTitleRow}>
                <Icon name="wallet-outline" size={18} color={colors.green} />
                <Title>{t("Account Balance", data.language)}</Title>
              </View>
              <Text style={s.rowTitle}>{data.shop.name}</Text>
              {data.shop.address ? <Hint>{data.shop.address}</Hint> : null}
              <Text style={[s.rowTitle, { fontSize: 17 }]}>{customer.name}</Text>
              <CustomerContactInfo customer={customer} compact />
              <View style={statementStyles.balanceRow}>
                {([
                  [t("Opening Balance", data.language), openingDisplay],
                  [t("Closing Balance", data.language), closingDisplay],
                ] as const).map(([label, display]) => {
                  const palette = financialPalette[display.tone];
                  return <View key={label} style={[statementStyles.balanceCell, { backgroundColor: palette.background, borderColor: palette.border }]}>
                    <Text style={statementStyles.balanceLabel}>{label}</Text>
                    <Text style={[statementStyles.balanceAmount, { color: palette.text }]}>{money(display.amount)}</Text>
                    <Text style={[statementStyles.balancePosition, { color: palette.text }]}>{t(balancePositionKey(display.position), data.language)}</Text>
                  </View>;
                })}
              </View>
            </Card>
            <Card style={statementStyles.sectionCard}>
              <View style={customerDetailsStyles.transactionTitleRow}>
                <Icon name="stats-chart-outline" size={18} color={colors.blue} />
                <Title>{t("Financial Information", data.language)}</Title>
              </View>
              <Row icon="arrow-up-outline" title="Udhari Given" value={money(m.credit)} color={colors.blue} />
              <Row icon="arrow-down-outline" title="Payment Received" value={money(m.payment)} color={colors.green} />
              {m.refund > 0 ? <Row icon="return-down-back-outline" title="Advance Refunded" value={money(m.refund)} color={colors.orange} /> : null}
              <Hint>
                Opening Balance = Previous Period’s Closing Balance. For the first recorded period, the original opening position is Opening Outstanding − Opening Advance; those amounts are included in that period’s activity.
              </Hint>
              <Hint>
                Closing Balance = Opening Balance + Udhari Given − Payment Received + Advance Refunded ± Other Adjustments (if supported). Positive = Outstanding; negative = Advance; zero = Settled.
              </Hint>
              <Hint>
                Current Outstanding = MAX(0, Closing Balance). Available Advance = MAX(0, −Closing Balance).
              </Hint>
              <MonthlyKhataStatementActions
                customerId={customer.id}
                month={month}
                transactionFilter="All"
                customerSearch=""
                customerCreatedDateFilter=""
                loadStatement={loadMonthlyKhataStatement}
              />
            </Card>
            <Card style={statementStyles.sectionCard}>
              <View style={customerDetailsStyles.transactionTitleRow}>
                <Icon name="time-outline" size={18} color={colors.dark} />
                <Title>{t("Transaction History", data.language)}</Title>
              </View>
              {!eligibleEntries.length ? <Hint>{t("No transactions in this period", data.language)}</Hint> : null}
              {visibleEntries.items.map((entry) => (
                <Row
                  key={entry.id}
                  title={entryLabel(entry.type)}
                  subtitle={`${entryDateTime(entry, localeTag(data.language))}${entry.note?.trim() ? ` · ${entry.note.trim()}` : ""}`}
                  value={transactionAmountText(entry, money)}
                  color={financialPalette[entry.type === "credit" ? "red" : entry.type === "refund" ? "amber" : "green"].text}
                  onPress={() => go("transaction", entry.id)}
                />
              ))}
              {visibleEntries.hasMore ? <Button
                icon="reload-outline"
                title={t("Load More", data.language)}
                style={statementStyles.loadMore}
                iconColor="#B45309"
                textColor="#92400E"
                onPress={() => setStatementHistoryPage((previous) => ({
                  key: statementKey,
                  visibleCount: nextVisibleCount(previous.key === statementKey ? previous.visibleCount : 10, eligibleEntries.length, 10),
                }))}
              /> : null}
            </Card>
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
            <View style={customerDetailsStyles.transactionTitleRow}>
              <Icon name="bar-chart-outline" size={18} color={colors.dark} />
              <Title>6-Month Udhari Trend</Title>
            </View>
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
            <View style={customerDetailsStyles.transactionTitleRow}>
              <Icon name="pie-chart-outline" size={18} color={colors.dark} />
              <Title>Customer Balance Distribution</Title>
            </View>
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
              "downloadReports",
              "profile",
              "manageCustomers",
              "reports",
              "notifications",
              "settings",
              "help",
              "subscription",
              "referral",
              "audit",
              "account",
            ] as Screen[]
          ).map((screen) => (
            <Row
              key={screen}
              title={screen === "downloadReports" ? t("Download", data.language) : titles[screen] || screen}
              icon={screen === "downloadReports" ? "download-outline" : screen === "profile" ? "person-circle-outline" : screen === "manageCustomers" ? "people-outline" : screen === "reports" ? "bar-chart-outline" : screen === "notifications" ? "notifications-outline" : screen === "settings" ? "settings-outline" : screen === "help" ? "help-circle-outline" : screen === "subscription" ? "card-outline" : screen === "referral" ? "gift-outline" : screen === "audit" ? "document-text-outline" : "log-out-outline"}
              onPress={() => go(screen)}
            />
          ))}
          <Hint>Digital Khata 1.0 • Local demo</Hint>
        </>
      );
      break;
    case "downloadReports": {
      const query = reportCustomerSearch.trim().toLocaleLowerCase();
      const customerDisplayName = (item: Customer) => {
        const sameName = data.customers.filter((candidate) => candidate.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase());
        if (sameName.length < 2) return item.name;
        return `${item.name} · ${item.phone || formatCustomerCreatedOn(item.createdAt) || item.id.slice(0, 8)}`;
      };
      const reportCustomerMatches = data.customers.filter((item) => !query ||
        [item.name, item.phone, item.address, (item.createdAt || "").slice(0, 10)].some((value) => value.toLocaleLowerCase().includes(query)))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id));
      const customDateState = reportKind === "custom" ? customReportDateState(reportFromDate, reportToDate) : "valid";
      const customDatesIncomplete = reportKind === "custom" && customDateState === "incomplete";
      const customRangeInvalid = reportKind === "custom" && (customDateState === "invalid" || customDateState === "invalidOrder");
      const reportKinds: { kind: DownloadReportKind; icon: React.ComponentProps<typeof Icon>["name"]; title: string }[] = [
        { kind: "all", icon: "list-outline", title: t("All Transactions", data.language) },
        { kind: "today", icon: "today-outline", title: t("Today", data.language) },
        { kind: "thisMonth", icon: "calendar-outline", title: t("This Month", data.language) },
        { kind: "lastMonth", icon: "calendar-clear-outline", title: t("Last Month", data.language) },
        { kind: "custom", icon: "calendar-outline", title: t("Custom Date Range", data.language) },
      ];
      const activeReportKind = reportKinds.find((item) => item.kind === reportKind)!;
      const visibleReportTransactions = reportPreview ? visibleDownloadReportTransactions(reportPreview.transactions, reportVisibleCount) : [];
      const reportCustomerSelection = reportCustomerId
        ? data.customers.find((item) => item.id === reportCustomerId)
        : undefined;
      const reportActions = reportPreview && reportPreview.transactions.length > 0 && !reportPreviewLoading && !customRangeInvalid && !customDatesIncomplete
        ? <DownloadReportActions kind={reportKind} customerId={reportCustomerId} fromDate={reportFromDate} toDate={reportToDate} loadReport={loadDownloadReport} onReportLoaded={(freshReport) => {
          setReportPreview(freshReport);
          setReportVisibleCount((count) => Math.min(count, freshReport.transactions.length));
        }} />
        : null;
      content = <>
        <Card style={{ gap: 10, borderColor: colors.blueBorder, backgroundColor: "#F8FBFF" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Icon name="people-outline" color={colors.blue} /><Title>{t("Customer Filter", data.language)}</Title></View>
          <Field label="Search Customer" placeholder="Search Customer" value={reportCustomerSearch} onChangeText={setReportCustomerSearch} autoCapitalize="none" />
          <Row icon="people-outline" title={t("All Customers", data.language)} value={reportCustomerId === null ? t("Selected", data.language) : undefined} onPress={() => setReportCustomerId(null)} />
          {reportCustomerSelection ? <Row icon="person-outline" title={customerDisplayName(reportCustomerSelection)} value={t("Selected", data.language)} onPress={() => setReportCustomerId(null)} /> : null}
          {query ? (reportCustomerMatches.length ? <View style={{ maxHeight: 220 }}><ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">{reportCustomerMatches.map((item) => <Row key={item.id} icon={item.id === reportCustomerId ? "checkmark-circle" : "person-outline"} title={customerDisplayName(item)} value={item.phone || formatCustomerCreatedOn(item.createdAt) || t("Not added", data.language)} onPress={() => { setReportCustomerId(item.id); setReportCustomerSearch(""); }} />)}</ScrollView></View> : <Hint>{t("No customers found", data.language)}</Hint>) : null}
        </Card>
        <Card style={{ gap: 10, borderColor: colors.greenBorder }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Icon name="options-outline" color={colors.green} /><Title>{t("Select Report Type", data.language)}</Title></View>
          <Button icon={activeReportKind.icon} title={activeReportKind.title} secondary onPress={() => setReportKindPickerVisible(true)} accessibilityLabel={t("Select Report Type", data.language)} />
          {reportKind === "custom" ? <>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 5 }}>{t("From Date", data.language)}</Text><Button icon="calendar-outline" title={reportFromDate ? new Date(`${reportFromDate}T12:00:00`).toLocaleDateString(localeTag(data.language)) : "DD/MM/YYYY"} secondary onPress={() => setReportDatePicker("from")} /></View>
              <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 5 }}>{t("To Date", data.language)}</Text><Button icon="calendar-outline" title={reportToDate ? new Date(`${reportToDate}T12:00:00`).toLocaleDateString(localeTag(data.language)) : "DD/MM/YYYY"} secondary onPress={() => setReportDatePicker("to")} /></View>
            </View>
            {reportFromDate || reportToDate ? <Button icon="close-circle-outline" title={t("Clear Date Range", data.language)} secondary onPress={() => { setReportFromDate(""); setReportToDate(""); }} /> : null}
            {customRangeInvalid ? <Hint style={{ color: colors.red }}>{customDateState === "invalidOrder" ? t("From Date cannot be later than To Date.", data.language) : t("Invalid date range.", data.language)}</Hint> : null}
          </> : null}
        </Card>
        <Card style={{ gap: 10, borderColor: colors.blueBorder }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}><Icon name="receipt-outline" color={colors.blue} /><Title>{t("Transaction History", data.language)}</Title></View>
            {!customRangeInvalid && !customDatesIncomplete && reportPreview ? <Hint style={{ fontWeight: "700", color: colors.dark }}>{t("Total Transactions: {{count}}", data.language, { count: reportPreview.transactions.length })}</Hint> : null}
          </View>
          {!customDatesIncomplete && !customRangeInvalid && reportPreviewLoading ? <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}><ActivityIndicator color={colors.blue} /><Hint>{t("Loading Transactions", data.language)}</Hint></View> : null}
          {!customDatesIncomplete && !customRangeInvalid && !reportPreviewLoading && reportPreviewError ? <View style={{ alignItems: "center", paddingVertical: 20, gap: 6 }}><Icon name="alert-circle-outline" color={colors.orange} size={28} /><Hint>{t("Unable to load transactions.", data.language)}</Hint></View> : null}
          {customDatesIncomplete ? <Hint style={{ textAlign: "center", paddingVertical: 18 }}>{t("Select From Date and To Date to view transactions.", data.language)}</Hint> : null}
          {!customDatesIncomplete && !customRangeInvalid && !reportPreviewLoading && !reportPreviewError && reportPreview?.transactions.length === 0 ? <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}><Icon name="file-tray-outline" color={colors.muted} size={34} /><Text style={{ color: colors.dark, fontSize: 16, fontWeight: "800" }}>{t("No Transactions Found", data.language)}</Text><Hint style={{ textAlign: "center" }}>{t("No transactions are available for the selected customer and period.", data.language)}</Hint></View> : null}
          {!customDatesIncomplete && !customRangeInvalid && !reportPreviewLoading && !reportPreviewError ? visibleReportTransactions.map((entry) => <View key={entry.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: "#FFFFFF", padding: 12, gap: 7 }}>
            {reportCustomerId === null ? <Text style={{ color: colors.dark, fontSize: 14, fontWeight: "800" }}>{entry.customerName}</Text> : null}
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
              <View style={{ flex: 1, gap: 6 }}><TransactionTypeBadge label={entry.label} compact /><Text style={{ color: colors.muted, fontSize: 12 }}>{entry.displayDate}</Text></View>
              <Text style={{ color: entry.type === "credit" ? colors.red : colors.green, fontSize: 16, fontWeight: "800", flexShrink: 0 }}>{formatCurrency(entry.amount, data.language)}</Text>
            </View>
            {entry.note?.trim() ? <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>{entry.note.trim()}</Text> : null}
            {entry.syncState === "pending" || entry.syncState === "failed" || entry.syncState === "conflict" ? <Hint style={{ color: entry.syncState === "conflict" ? colors.orange : colors.muted }}>{t(entry.syncState === "pending" ? "Pending Sync" : entry.syncState === "failed" ? "Sync Failed" : "Conflict", data.language)}</Hint> : null}
          </View>) : null}
          {!reportPreviewLoading && !customRangeInvalid && !customDatesIncomplete && (reportPreview?.transactions.length || 0) > reportVisibleCount ? <Button icon="chevron-down-outline" title={t("Load More", data.language)} onPress={() => setReportVisibleCount((count) => nextDownloadReportCount(count, reportPreview?.transactions.length || count))} style={{ width: "100%", minHeight: 48, marginTop: 4, backgroundColor: colors.amberBg, borderColor: colors.amberBorder }} textColor={colors.dark} iconColor={colors.orange} /> : null}
          {reportActions}
        </Card>
        <Modal visible={reportKindPickerVisible} transparent animationType="fade" onRequestClose={() => setReportKindPickerVisible(false)}>
          <Pressable onPress={() => setReportKindPickerVisible(false)} style={{ flex: 1, justifyContent: "center", backgroundColor: "rgba(15,23,42,0.4)", padding: 20 }}>
            <Pressable onPress={(event) => event.stopPropagation()} style={{ backgroundColor: "white", borderRadius: 16, padding: 16, gap: 8 }}>
              <Title>{t("Select Report Type", data.language)}</Title>
              {reportKinds.map(({ kind, icon, title }) => <Row key={kind} icon={icon} title={title} value={kind === reportKind ? t("Selected", data.language) : undefined} onPress={() => { if (kind !== reportKind) { setReportFromDate(""); setReportToDate(""); } setReportKind(kind); setReportKindPickerVisible(false); }} />)}
              <Button title={t("Cancel", data.language)} secondary onPress={() => setReportKindPickerVisible(false)} />
            </Pressable>
          </Pressable>
        </Modal>
        <ReportDatePicker visible={reportDatePicker !== ""} value={reportDatePicker === "from" ? reportFromDate : reportToDate} language={data.language} title={reportDatePicker === "from" ? "From Date" : "To Date"} onClose={() => setReportDatePicker("")} onSelect={(date) => { if (reportDatePicker === "from") setReportFromDate(date); else setReportToDate(date); setReportDatePicker(""); }} />
      </>;
      break;
    }
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
          <Row icon="person-outline" title="Owner" value={data.shop.owner} />
          <Row icon="call-outline" title="Phone" value={data.shop.phone} />
          <Row icon="chatbubble-outline" title="WhatsApp" value={data.shop.whatsapp || "Not added"} />
          <Row icon="location-outline" title="Address" value={data.shop.address || "Not added"} />
          <Button icon="create-outline" title="Edit Profile" onPress={() => go("setup")} />
        </>
      );
      break;
    case "settings":
      content = (
        <>
          <View style={customerDetailsStyles.transactionTitleRow}>
            <Icon name={connectivityStatus === "online" ? "wifi-outline" : connectivityStatus === "checking" ? "sync-outline" : "cloud-offline-outline"} size={18} color={connectivityStatus === "online" ? colors.green : colors.muted} />
            <Title>NETWORK</Title>
          </View>
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
          <View style={customerDetailsStyles.transactionTitleRow}>
            <Icon
              name={syncStatus.kind === "loading" ? "sync-outline"
                : syncStatus.kind === "unavailable" ? "help-circle-outline"
                  : syncStatus.status === "synced" ? "cloud-done-outline"
                    : syncStatus.status === "syncing" ? "sync-outline"
                      : syncStatus.status === "pending" ? "time-outline"
                        : syncStatus.status === "offline" ? "cloud-offline-outline" : "alert-circle-outline"}
              size={18}
              color={syncStatus.kind === "unavailable" || syncStatus.kind === "loading" || (syncStatus.kind === "available" && syncStatus.status === "offline") ? colors.muted
                : syncStatus.kind === "available" && ["failed", "conflict"].includes(syncStatus.status) ? colors.orange : colors.green}
            />
            <Title>SYNC STATUS</Title>
          </View>
          {syncStatus.kind === "loading" ? <Hint>Reading this shop’s synchronization queue…</Hint> : null}
          {syncStatus.kind === "unavailable" ? (
            <Hint>
              {syncStatus.reason === "not_signed_in" ? "Sign in to a shop to view its synchronization queue."
                : syncStatus.reason === "shop_context" ? "The signed-in shop identity is not available for this queue. Sign in again to refresh it."
                  : syncStatus.reason === "storage" ? "Encrypted offline storage is unavailable, so the synchronization queue cannot be read. Your local data has not been cleared."
                    : "Could not read the encrypted synchronization queue. Your local data has not been cleared; check Storage Diagnostics and retry."}
            </Hint>
          ) : null}
          {syncStatus.kind === "available" ? (
            <>
              <Text style={s.rowTitle} accessibilityRole="text">
                {syncStatus.status === "synced" ? "Synced"
                  : syncStatus.status === "pending" ? "Pending Sync"
                    : syncStatus.status === "syncing" ? "Syncing"
                      : syncStatus.status === "failed" ? "Sync Failed"
                        : syncStatus.status === "conflict" ? "Conflict" : "Offline"}
              </Text>
              <Hint>{`${syncStatus.counts.pending} pending · ${syncStatus.counts.failed} failed · ${syncStatus.counts.conflicts + syncStatus.counts.mobileConflicts} conflicts`}</Hint>
            </>
          ) : null}
          {syncStatus.kind === "available" && !!syncStatus.counts.conflicts && (
            <Hint>
              {syncStatus.counts.conflicts} transaction conflict{syncStatus.counts.conflicts === 1 ? " needs" : "s need"} your decision. Both versions remain saved.
            </Hint>
          )}
          {syncStatus.kind === "available" && !!syncStatus.counts.mobileConflicts && (
            <Hint>
              {syncStatus.counts.mobileConflicts} customer change{syncStatus.counts.mobileConflicts === 1 ? " uses" : "s use"} a mobile number already assigned in this shop. The local customer and its ledger remain saved; no records were merged. Change the number on the local customer, then retry synchronization.
            </Hint>
          )}
          {syncStatus.kind === "available" && !!syncStatus.counts.pending && (
            <Hint>
              {syncStatus.counts.pending} saved change{syncStatus.counts.pending === 1 ? " is" : "s are"} waiting to sync.
            </Hint>
          )}
          {syncStatus.kind === "available" && !!syncStatus.counts.failed && (
            <Hint>
              {syncStatus.counts.failed} saved change{syncStatus.counts.failed === 1 ? "" : "s"} failed to sync. They remain on this phone and will not retry automatically.
            </Hint>
          )}
          {syncStatus.kind === "available" && syncStatus.status === "synced" && (
            <Hint>There are no pending, failed, or conflicted local operations.</Hint>
          )}
          {syncStatus.kind === "available" && !!syncStatus.counts.failed && (
            <Button
              icon="refresh-outline"
              title="Retry failed sync"
              onPress={() => void retryFailedSync()}
              disabled={busy}
            />
          )}
          <Title>ACCOUNT</Title>
          <Row icon="phone-portrait-outline" title="Mobile Number" value={data.shop.phone} />
          <Row
            icon="lock-closed-outline"
            title="Change PIN"
            onPress={() =>
              Alert.alert(
                "PIN not available",
                "Mobile sign-in uses secure OTP verification. PIN setup is not available yet.",
              )
            }
          />
          <Row icon="log-out-outline" title="Logout / Account actions" onPress={() => go("account")} />
          <Hint>
            Sign-in and account data are connected to the Digital Khata server.
          </Hint>
          <Title>KHATA</Title>
          <Row icon="notifications-outline" title="Reminder Settings" onPress={() => go("reminders")} />
          <Title>Default payment method</Title>
          <Chips
            items={["Cash", "UPI", "Bank", "Other"]}
            value={data.defaultMethod}
            onChange={(v) => commit({ ...data, defaultMethod: v })}
          />
          <Title>DATA</Title>
          <Row icon="download-outline" title="Export data (CSV)" onPress={() => exportData(false)} />
          <Row icon="save-outline" title="Save backup (JSON)" onPress={() => exportData(true)} />
          <Row icon="refresh-outline" title="Restore backup" onPress={restore} />
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
      const requestedDuration = Number(subscriptionDuration);
      const duration = selected?.durations.some((item) => item.months === requestedDuration)
        ? requestedDuration
        : selected?.durations[0]?.months ?? requestedDuration;
      const price = selected?.durations.find((item) => item.months === duration);
      const asRupees = (minor?: number | null) => money((minor || 0) / 100);
      const walletAvailableMinor = referralSnapshot && current?.shopId && referralSnapshot.shopId === current.shopId ? referralSnapshot.wallet.availableMinor : 0;
      const walletAppliedEstimate = price && useWalletForPurchase
        ? walletAvailableMinor >= price.finalAmountMinor
          ? price.finalAmountMinor
          : Math.min(walletAvailableMinor, Math.max(0, price.finalAmountMinor - 100))
        : 0;
      const estimatedCashPayableMinor = price ? Math.max(0, price.finalAmountMinor - walletAppliedEstimate) : 0;
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
              <Row icon="ribbon-outline" title="Plan" value={current.plan.name} />
              <Row icon="checkmark-circle-outline" title="Status" value={t("Active", data.language)} />
              <Row icon="calendar-outline" title="Start date" value={current.startsAt ? new Date(current.startsAt).toLocaleDateString("en-IN") : "—"} />
              <Row icon="calendar-outline" title="Expiry" value={current.expiresAt ? new Date(current.expiresAt).toLocaleDateString("en-IN") : t("Never", data.language)} />
              <Row icon="time-outline" title="Time remaining" value={remainingText} />
              <Row icon="people-outline" title="Customer limit" value={current.customerUsage.unlimited ? t("Unlimited", data.language) : String(current.customerUsage.limit ?? 0)} />
              <Row icon="people-outline" title="Customers used" value={String(current.customerUsage.used)} />
              {!current.customerUsage.unlimited && <Row icon="people-outline" title="Customer capacity left" value={String(current.customerUsage.remaining ?? 0)} />}
              {current.durationMonths > 0 && <Row icon="calendar-outline" title="Duration" value={t("{{count}} months", data.language, { count: current.durationMonths })} />}
              {current.amountPaidMinor !== null && <Row icon="card-outline" title="Amount paid" value={asRupees(current.amountPaidMinor)} />}
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
            <Pressable key={item.code} onPress={() => { setPlan(item.name); setSubscriptionDuration(String(item.durations[0]?.months ?? 1)); }}>
              <Card style={{ borderColor: plan === item.name || plan.toLowerCase() === item.code ? colors.green : colors.border, borderWidth: plan === item.name || plan.toLowerCase() === item.code ? 2 : 1 }}>
                <View style={s.split}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    <Icon name={item.code === "free" ? "gift-outline" : item.code === "pro" ? "ribbon-outline" : "business-outline"} color={colors.green} size={22} />
                    <Text style={[s.heading, { fontSize: 20 }]}>{item.name}</Text>
                  </View>
                  <Text style={s.stat}>{asRupees(item.monthlyPriceMinor)}{item.monthlyPriceMinor ? "/mo" : ""}</Text>
                </View>
                {item.description ? <Hint>{item.description}</Hint> : null}
                <Hint>{item.unlimitedCustomers ? t("Unlimited customers", data.language) : t("{{count}} customers", data.language, { count: item.customerLimit ?? 0 })}</Hint>
                {Object.entries(item.entitlements || {}).filter(([, value]) => value !== false && value != null).map(([key, value]) => (
                  <Hint key={`${item.code}-${key}`}>{value === true ? key.replaceAll("_", " ") : `${key.replaceAll("_", " ")}: ${String(value)}`}</Hint>
                ))}
                {(item.features || []).map((feature) => <Hint key={`${item.code}-feature-${feature}`}>{feature}</Hint>)}
              </Card>
            </Pressable>
          ))}
          {selected && selected.code !== "free" && (
            <Card>
              <View style={customerDetailsStyles.transactionTitleRow}>
                <Icon name="calendar-outline" size={18} color={colors.dark} />
                <Title>Subscription duration</Title>
              </View>
              <Chips items={selected.durations.map((item) => t("{{count}} months", data.language, { count: item.months }))} value={t("{{count}} months", data.language, { count: price?.months ?? duration })} onChange={(value) => setSubscriptionDuration(value.split(" ")[0])} />
              {price && (
                <>
                  {price.discountPercent > 0 && <Hint>{t("Save {{discountPercent}}% for {{months}} months", data.language, { discountPercent: price.discountPercent, months: price.months })}</Hint>}
                  <Row icon="cash-outline" title="Base price" value={asRupees(price.basePriceMinor)} />
                  <Row icon="pricetag-outline" title={t("Discount ({{percent}}%)", data.language, { percent: price.discountPercent })} value={`−${asRupees(price.discountAmountMinor)}`} />
                  <Row icon="wallet-outline" title="Subtotal" value={asRupees(price.taxableAmountMinor)} />
                  <Row icon="receipt-outline" title={t("Tax ({{rate}}%)", data.language, { rate: (price.taxPercent).toFixed(2) })} value={`+${asRupees(price.taxAmountMinor)}`} />
                  <Row icon="card-outline" title="Final payable" value={asRupees(price.finalAmountMinor)} />
                </>
              )}
            </Card>
          )}
          {selected && selected.code !== "free" && price && (
            <Card>
              <Toggle
                label={`Use wallet balance${referralSnapshot && current?.shopId && referralSnapshot.shopId === current.shopId ? ` · ${asRupees(walletAvailableMinor)} available` : " · refresh online to load"}`}
                value={useWalletForPurchase}
                onChange={setUseWalletForPurchase}
                disabled={walletAvailableMinor <= 0 || subscriptionPaymentLoading}
              />
              {useWalletForPurchase && (
                <>
                  <Row icon="wallet-outline" title="Wallet applied (estimate)" value={asRupees(walletAppliedEstimate)} />
                  <Row icon="card-outline" title="Remaining to pay" value={asRupees(estimatedCashPayableMinor)} />
                  <Hint>The server checks your available wallet balance again when creating the order. Any remainder is paid through Cashfree.</Hint>
                </>
              )}
            </Card>
          )}
          <Button
            icon={useWalletForPurchase && estimatedCashPayableMinor === 0 ? "wallet-outline" : "card-outline"}
            title={subscriptionPaymentLoading ? "Processing securely…" : useWalletForPurchase && estimatedCashPayableMinor === 0 ? `Buy with wallet · ${asRupees(price?.finalAmountMinor)}` : useWalletForPurchase ? `Use wallet + Cashfree · ${asRupees(estimatedCashPayableMinor)}` : `Pay securely with Cashfree${price ? ` • ${asRupees(price.finalAmountMinor)}` : ""}`}
            loading={subscriptionPaymentLoading}
            disabled={!subscriptionSnapshot?.checkoutEnabled || !selected || selected.code === "free" || !price}
            onPress={() => void purchaseSubscription()}
          />
          <Button icon="receipt-outline" title="Payment History" secondary onPress={() => go("subscriptionPayments")} />
          <Hint>
            {subscriptionSnapshot?.cachedAt
              ? `Last synchronized ${new Date(subscriptionSnapshot.cachedAt).toLocaleString("en-IN")}. ${subscriptionSnapshot.notificationsGranted === false ? "Enable notifications to receive local renewal reminders." : "Renewal reminders are scheduled when permission is available."} ${subscriptionSnapshot.checkoutEnabled ? "Payments require an internet connection and are confirmed by the server." : "Cashfree checkout is not enabled for this app build."}`
              : "Subscription information is server-verified and cached securely for offline viewing. Payments require an internet connection and activate only after server verification."}
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
            <View style={customerDetailsStyles.transactionTitleRow}>
              <Icon name="card-outline" size={18} color={colors.dark} />
              <Title>{String(payment.planCode || "").toUpperCase()} • {payment.durationMonths} months</Title>
            </View>
            <Row icon="cash-outline" title="Original amount" value={money((payment.pricing?.originalAmountMinor || 0) / 100)} />
            <Row icon="pricetag-outline" title="Discount" value={money((payment.pricing?.discountAmountMinor || 0) / 100)} />
            <Row icon="receipt-outline" title="Tax" value={money((payment.pricing?.taxAmountMinor || 0) / 100)} />
            <Row icon="card-outline" title="Amount paid" value={money((payment.amountMinor || 0) / 100)} />
            {(payment.walletAppliedMinor || 0) > 0 && <Row icon="wallet-outline" title="Wallet used" value={money(payment.walletAppliedMinor / 100)} />}
            {(payment.cashPaidMinor || 0) > 0 && payment.walletAppliedMinor > 0 && <Row icon="card-outline" title="Cashfree paid" value={money(payment.cashPaidMinor / 100)} />}
            <Row icon="calendar-outline" title="Date" value={new Date(payment.createdAt).toLocaleString("en-IN")} />
            <Row icon={payment.status === "paid" ? "checkmark-circle-outline" : payment.status === "failed" ? "close-circle-outline" : payment.status === "refunded" || payment.status === "partially_refunded" ? "refresh-outline" : "time-outline"} title="Status" value={payment.status} />
            {payment.gatewayPaymentId && <Row icon="receipt-outline" title="Payment reference" value={payment.gatewayPaymentId} />}
            {payment.gatewayOrderId && <Row icon="receipt-outline" title="Order reference" value={payment.gatewayOrderId} />}
            {payment.method && <Row icon="card-outline" title="Payment method" value={payment.method} />}
            {payment.currency && <Row title="Currency" value={payment.currency} />}
            {payment.refunded && <Row icon="refresh-outline" title="Refund status" value={`${payment.status} • ${money((payment.refundedAmountMinor || 0) / 100)} refunded`} />}
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
              icon="download-outline"
              title={subscriptionPageLoading ? "Loading…" : "Load more payments"}
              secondary
              disabled={subscriptionPageLoading}
              onPress={() => void loadMoreSubscriptionPayments()}
            />
          ) : null}
          {subscriptionLoadError ? <Hint>{subscriptionLoadError}</Hint> : null}
          {subscriptionLoading && <ActivityIndicator color={colors.green} />}
          <Button icon="refresh-outline" title="Refresh" secondary onPress={() => void refreshSubscriptionInfo()} />
        </>,
        empty: (subscriptionSnapshot?.payments || []).length === 0 && !subscriptionLoading
          ? <Empty title="No payments yet" description="Verified subscription payments will appear here." />
          : null,
      };
      break;
      }
    case "referral": {
      const referralBase = (process.env.EXPO_PUBLIC_REFERRAL_BASE_URL || "").replace(/\/+$/, "");
      const referralLink = referralSnapshot && referralBase
        ? `${referralBase}${referralSnapshot.referralUrlPath}`
        : referralSnapshot ? `digitalkhata://refer/${referralSnapshot.referralCode}` : "";
      content = (
        <>
          <Card style={{ padding: 14, gap: 10 }}>
            <View style={customerDetailsStyles.transactionTitleRow}>
              <Icon name="gift-outline" size={20} color={colors.green} />
              <Title>Refer & Earn</Title>
            </View>
            <Hint>Invite a new shopkeeper to Digital Khata. Once they create their shop and add the customer count set by the administrator, both shops receive wallet credit.</Hint>
            {referralLoading ? <ActivityIndicator color={colors.green} /> : null}
            {referralLoadError ? <Hint>{referralLoadError}</Hint> : null}
            {referralSnapshot ? (
              <>
                <Row icon="pricetag-outline" title="Your referral code" value={referralSnapshot.referralCode} />
                <Button
                  icon="share-social-outline"
                  title="Share referral link"
                  disabled={connectivityStatus === "offline" && !referralSnapshot.referralCode}
                  onPress={() => {
                    const message = `Join me on Digital Khata to manage shop customers and udhari. Use my referral code ${referralSnapshot.referralCode}${referralLink ? `\n${referralLink}` : ""}`;
                    void Share.share({ message }).catch(() => Alert.alert("Unable to share referral", "Please try again."));
                  }}
                />
                {!referralBase ? <Hint>Configure EXPO_PUBLIC_REFERRAL_BASE_URL in the mobile build to share the public referral landing page. The code can still be shared for manual entry.</Hint> : null}
              </>
            ) : !referralLoading && !referralLoadError ? <Hint>Referral and wallet information has not been loaded yet.</Hint> : null}
          </Card>
          {referralSnapshot ? (
            <>
              <Card style={{ padding: 14, gap: 8 }}>
                <View style={customerDetailsStyles.transactionTitleRow}><Icon name="wallet-outline" size={20} color={colors.green} /><Title>Subscription Wallet</Title></View>
                <Text style={[s.amount, { color: colors.green }]}>{money(referralSnapshot.wallet.availableMinor / 100)}</Text>
                <Hint>Available to use toward eligible subscription purchases. Wallet balance and spending are confirmed by the server.</Hint>
              </Card>
              <Title>Referral Progress</Title>
              <Card style={{ padding: 14, gap: 8 }}>
                <Row icon="time-outline" title="Pending" value={String(referralSnapshot.referrals.counts.pending)} />
                <Row icon="checkmark-circle-outline" title="Rewarded" value={String(referralSnapshot.referrals.counts.rewarded)} />
                {referralSnapshot.referrals.items.length ? referralSnapshot.referrals.items.slice(0, 8).map((item) => (
                  <Row key={item.id} icon={item.status === "rewarded" ? "checkmark-circle-outline" : "time-outline"} title={item.role === "referred" ? "Referred shop" : "Your referral"} subtitle={`${item.status} • ${item.requiredCustomers} eligible customers required`} value={item.status === "rewarded" ? money(item.rewardMinor / 100) : "—"} />
                )) : <Hint>No referrals yet. Share your code to invite a new shopkeeper.</Hint>}
              </Card>
              <Title>Wallet Activity</Title>
              <Card style={{ padding: 14, gap: 8 }}>
                {referralSnapshot.wallet.items.length ? referralSnapshot.wallet.items.slice(0, 10).map((item) => (
                  <Row key={item.id} icon={item.direction === "credit" ? "add-circle-outline" : "remove-circle-outline"} title={item.description} subtitle={new Date(item.createdAt).toLocaleDateString("en-IN")} value={`${item.direction === "credit" ? "+" : "−"}${money(item.amountMinor / 100)}`} color={item.direction === "credit" ? colors.green : colors.red} />
                )) : <Hint>Wallet rewards and subscription spending will appear here.</Hint>}
              </Card>
            </>
          ) : null}
        </>
      );
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
        header: <View style={{ gap: 8 }}>
          <Hint>Server-recorded customer and transaction activity for this shop.</Hint>
          <Button icon="trash-outline" title="Restore Deleted Transactions" secondary textColor="#DC2626" iconColor="#DC2626" onPress={() => go("deletedTransactions")} />
        </View>,
        renderItem: (a) => (
          <Card>
              <Title>{t(lifecycleActivityLabels[a.action] || a.action, data.language)}</Title>
              <Hint>{new Date(a.date).toLocaleString("en-IN")}</Hint>
              {a.before && typeof a.before.amount === "number" && (
                <Hint>
                  Before: {money(a.before.amount)} • {entryDateTime(a.before, localeTag(data.language))} •{" "}
                  {a.before.note}
                </Hint>
              )}
              {a.after && typeof a.after.amount === "number" && (
                <Hint>
                  After: {money(a.after.amount)} • {entryDateTime(a.after, localeTag(data.language))} •{" "}
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
    case "deletedTransactions":
      {
      const query = search.trim().toLocaleLowerCase();
      const deleted = (data.deletedEntries || []).filter((item) => {
        const customerName = data.customers.find((customer) => customer.id === item.customerId)?.name || "";
        const matchesSearch = !query || [customerName, item.id, item.type, item.note || ""].some((value) => value.toLocaleLowerCase().includes(query));
        const matchesDate = !deletedDateFilter || (validDate(deletedDateFilter) && item.deletedAt.startsWith(deletedDateFilter));
        return matchesSearch && matchesDate && (filter === "All" || entryLabel(item.type) === filter);
      }).slice().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.id.localeCompare(b.id));
      const deletedPage = pageRecords(deleted);
      virtualizedRows = {
        data: deletedPage.items,
        keyExtractor: (item) => item.id,
        header: <View style={{ gap: 8 }}>
          <Hint>Deleted transactions are excluded from active balances. Restoring one returns it to the original financial date.</Hint>
          <Field label="Search customer, transaction ID or type" value={search} onChangeText={setSearch} autoCapitalize="none" />
          <Field label="Filter by deletion date (YYYY-MM-DD)" value={deletedDateFilter} onChangeText={setDeletedDateFilter} placeholder="2026-10-26" />
          <Chips items={["All", "Udhari Given", "Payment Received", "Advance Refund"]} value={filter} onChange={setFilter} />
        </View>,
        renderItem: (item) => {
          const customerName = data.customers.find((customer) => customer.id === item.customerId)?.name || "Customer unavailable";
          return <Card style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Title>{entryLabel(item.type)}</Title>
                <Hint>Customer: {customerName}</Hint>
              </View>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.dark }}>{money(item.amount)}</Text>
            </View>
            <Hint>Transaction Date: {entryDateTime(item, localeTag(data.language))}</Hint>
            <Hint>Deleted On: {new Date(item.deletedAt).toLocaleString("en-IN")}</Hint>
            <Hint>Transaction ID: {item.id}</Hint>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Button icon="eye-outline" title="View Details" secondary onPress={() => go("transaction", item.id)} /></View>
              <View style={{ flex: 1 }}><Button icon="refresh-outline" title="Restore Transaction" disabled={busy} onPress={() => restoreEntry(item)} /></View>
            </View>
          </Card>;
        },
        footer: listFooter(deletedPage.hasMore),
        empty: <Empty title="No deleted transactions" description="Deleted transactions for this shop will appear here." />,
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
              {route.screen === "downloadReports"
                ? t("Download Reports", data.language)
                : route.screen === "customer"
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
              contentContainerStyle={route.screen === "customer" || route.screen === "viewCustomer" ? [s.content, customerDetailsStyles.listContent] : s.content}
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
                <Hint>{`Sync queue: ${syncStatus.kind === "available" ? `${syncStatus.counts.pending} pending, ${syncStatus.counts.failed} failed, ${syncStatus.counts.conflicts + syncStatus.counts.mobileConflicts} conflicted` : syncStatus.kind === "unavailable" ? `Unavailable (${syncStatus.reason})` : "Loading"}`}</Hint>
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
