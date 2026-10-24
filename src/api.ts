import * as SecureStore from "expo-secure-store";
import {
  clearOfflineSession,
  rotateOfflineSessionToken,
} from "./offlineStore";
import type { Data } from "./model";
import type { PendingConflict, PendingSettingsConflict } from "./offlineStore";
import { createSyncDelta, normalizeSyncDelta, type SyncDelta, type SyncSettings } from "./syncDelta";
import { normalizeCustomerLifecycle } from "./customerLifecycle";
import { isAuthoritativeSessionRejection } from "./startupRecovery";
import { withoutLegacyDue, withoutLegacyDueFromAudit } from "./ledgerCompatibility";
import type { SubscriptionSnapshot } from "./subscription";
import { estimateServerClockOffset } from "./serverClock";

const configuredBase = process.env.EXPO_PUBLIC_API_URL || "http://10.0.2.2:4000/api/v1";
export const API_BASE_URL = `${configuredBase.trim().replace(/\/+$/, "").replace(/(?:\/api\/v1)+$/i, "")}/api/v1`;
export const HEALTH_CHECK_URL = `${API_BASE_URL}/health`;
let apiResponseObserver: ((status: number) => void) | null = null;
let serverClockObserver: ((offsetMs: number) => void) | null = null;

export function setApiResponseObserver(observer: (status: number) => void) {
  apiResponseObserver = observer;
}

export function setServerClockObserver(observer: ((offsetMs: number) => void) | null) {
  serverClockObserver = observer;
}

export type BackendProbeResult = {
  apiBaseUrl: string;
  healthUrl: string;
  transportReachable: boolean;
  healthy: boolean;
  httpStatus: number | null;
  errorCategory:
    | "none"
    | "http_error"
    | "invalid_health_response"
    | "invalid_url"
    | "timeout"
    | "cleartext_blocked"
    | "network";
  errorDetail: string | null;
  durationMs: number;
};

function safeDiagnosticUrl(value: string) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "Invalid URL";
  }
}

/** Lightweight unauthenticated probe; it checks the configured API, not public internet. */
export async function probeBackendReachability(): Promise<BackendProbeResult> {
  const healthUrl = HEALTH_CHECK_URL;
  const startedAt = Date.now();
  const diagnosticBaseUrl = safeDiagnosticUrl(API_BASE_URL);
  const diagnosticHealthUrl = safeDiagnosticUrl(healthUrl);
  try {
    const parsed = new URL(healthUrl);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Unsupported URL scheme");
  } catch {
    return {
      apiBaseUrl: diagnosticBaseUrl,
      healthUrl: diagnosticHealthUrl,
      transportReachable: false,
      healthy: false,
      httpStatus: null,
      errorCategory: "invalid_url",
      errorDetail: "The configured API address is not a valid HTTP or HTTPS URL.",
      durationMs: Date.now() - startedAt,
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
    const responseReceivedAt = Date.now();
    const clockOffset = estimateServerClockOffset(
      response.headers.get("date"),
      startedAt,
      responseReceivedAt,
    );
    if (clockOffset !== null) serverClockObserver?.(clockOffset);
    if (!response.ok)
      return {
        apiBaseUrl: diagnosticBaseUrl,
        healthUrl: diagnosticHealthUrl,
        transportReachable: true,
        healthy: false,
        httpStatus: response.status,
        errorCategory: "http_error",
        errorDetail: `Health endpoint returned HTTP ${response.status}.`,
        durationMs: Date.now() - startedAt,
      };
    const result = await response.json().catch(() => null);
    const healthy = result?.status === "ok";
    return {
      apiBaseUrl: diagnosticBaseUrl,
      healthUrl: diagnosticHealthUrl,
      transportReachable: true,
      healthy,
      httpStatus: response.status,
      errorCategory: healthy ? "none" : "invalid_health_response",
      errorDetail: healthy ? null : "The endpoint did not return the expected healthy status.",
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed.";
    const safeMessage = message
      .replace(/[\r\n\t]+/g, " ")
      .replace(/https?:\/\/\S+/gi, "[URL]")
      .replace(/(authorization|bearer|token|password|secret)[^,; ]*/gi, "$1=[redacted]")
      .slice(0, 180);
    return {
      apiBaseUrl: diagnosticBaseUrl,
      healthUrl: diagnosticHealthUrl,
      transportReachable: false,
      healthy: false,
      httpStatus: null,
      errorCategory: controller.signal.aborted
        ? "timeout"
        : /cleartext.*not permitted|cleartext traffic.*not permitted/i.test(message)
          ? "cleartext_blocked"
          : "network",
      errorDetail: safeMessage,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}
const ACCESS = "khata.access.v1";
const REFRESH = "khata.refresh.v1";
const auditInput = (audit: Data["audit"][number]) => {
  const normalized = withoutLegacyDueFromAudit(audit);
  const before = normalized.before ? { ...normalized.before } : undefined;
  const after = normalized.after ? { ...normalized.after } : undefined;
  if (before) delete before.serverVersion;
  if (after) delete after.serverVersion;
  return { ...audit, ...(before ? { before } : {}), ...(after ? { after } : {}) };
};
type RefreshResult = "refreshed" | "invalid" | { kind: "unavailable"; status: number; code?: string };
type RequestOrigin = "foreground" | "session_restore" | "offline_sync";
type RefreshOutcome = RefreshResult | ApiTransportError;
let refreshJob: Promise<RefreshOutcome> | null = null;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload?: any) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiTransportError extends Error {
  constructor(readonly kind: "network" | "timeout") {
    super(kind === "timeout" ? "The request timed out" : "Network unavailable");
    this.name = "ApiTransportError";
  }
}

/** OTP may be accepted and the session stored even if the following account
 * bootstrap fails. Keep that stage distinct so callers do not ask users to
 * repeat a successfully verified, potentially single-use OTP. */
export class OtpVerifiedAccountLoadError extends Error {
  constructor(readonly cause: unknown) {
    super("OTP was verified, but account details could not be loaded");
    this.name = "OtpVerifiedAccountLoadError";
  }
}

async function request(
  path: string,
  options: RequestInit = {},
  retry = true,
  origin: RequestOrigin = "foreground",
): Promise<any> {
  const access = await SecureStore.getItemAsync(ACCESS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const requestStartedAt = Date.now();
  let response: Response;
  const startedAt = Date.now();
  const method = (options.method || "GET").toUpperCase();
  // Keep diagnostic paths useful while avoiding customer IDs and query values.
  const endpoint = path.split("?", 1)[0]
    .replace(/\/(customers|ledger|payments)\/[^/]+/gi, "/$1/:id")
    .replace(/\/[a-f\d]{24}(?=\/|$)/gi, "/:id");
  const logFailure = (details: {
    responseReceived: boolean;
    status?: number;
    code?: string;
    category: string;
  }) => {
    if (__DEV__) console.warn("Digital-Khata API request failed", {
      method,
      endpoint,
      status: details.status,
      code: details.code,
      durationMs: Date.now() - startedAt,
      responseReceived: details.responseReceived,
      origin,
      category: details.category,
    });
  };
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    const kind = controller.signal.aborted || (error instanceof Error && error.name === "AbortError")
      ? "timeout"
      : "network";
    logFailure({ responseReceived: false, category: kind });
    throw new ApiTransportError(
      kind,
    );
  } finally {
    clearTimeout(timeout);
  }
  const responseReceivedAt = Date.now();
  const clockOffset = estimateServerClockOffset(
    response.headers.get("date"),
    requestStartedAt,
    responseReceivedAt,
  );
  if (clockOffset !== null) serverClockObserver?.(clockOffset);
  // An HTTP response, including an authorization or validation response,
  // proves the configured backend is reachable. Business errors must not be
  // mistaken for network failures.
  apiResponseObserver?.(response.status);
  if (response.status === 401 && retry && path !== "/auth/refresh") {
    const refreshed = await refresh(origin);
    if (refreshed instanceof ApiTransportError) throw refreshed;
    if (refreshed === "refreshed") return request(path, options, false, origin);
    if (typeof refreshed === "object" && refreshed.kind === "unavailable")
      throw new ApiError("Could not validate the server session", refreshed.status, { code: refreshed.code });
  }
  if (response.status === 204) return undefined;
  const value = await response.json().catch(() => null);
  if (response.ok && (!value || typeof value !== "object")) {
    logFailure({ responseReceived: true, status: response.status, code: "INVALID_SERVER_RESPONSE", category: "invalid_response" });
    throw new ApiError("The server returned an invalid response", 502, { code: "INVALID_SERVER_RESPONSE" });
  }
  if (!response.ok) {
    const code = typeof value?.code === "string" ? value.code : undefined;
    logFailure({
      responseReceived: true,
      status: response.status,
      code,
      category: response.status === 401 || response.status === 403 ? "authentication"
        : response.status === 409 ? "conflict"
          : response.status === 429 ? "rate_limit"
            : response.status >= 500 ? "server" : "http_error",
    });
    const message = typeof value?.error === "string"
      ? value.error
      : `Server error (${response.status})`;
    throw new ApiError(message, response.status, value ?? undefined);
  }
  return value;
}
async function refresh(origin: RequestOrigin = "foreground"): Promise<RefreshOutcome> {
  if (refreshJob) return refreshJob;
  refreshJob = (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH);
      if (!refreshToken) return "invalid";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const startedAt = Date.now();
      let response: Response;
        try {
          response = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
            signal: controller.signal,
          });
        } catch (error) {
          if (__DEV__) console.warn("Digital-Khata API request failed", {
            method: "POST", endpoint: "/auth/refresh", durationMs: Date.now() - startedAt,
            responseReceived: false, origin,
            category: controller.signal.aborted || (error instanceof Error && error.name === "AbortError") ? "timeout" : "network",
          });
          throw new ApiTransportError(
            controller.signal.aborted ||
              (error instanceof Error && error.name === "AbortError")
              ? "timeout"
              : "network",
          );
        } finally {
        clearTimeout(timeout);
      }
      apiResponseObserver?.(response.status);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const code = typeof errorBody?.code === "string" ? errorBody.code : undefined;
        if (__DEV__) console.warn("Digital-Khata API request failed", {
          method: "POST", endpoint: "/auth/refresh", status: response.status,
          code, durationMs: Date.now() - startedAt, responseReceived: true, origin,
          category: response.status === 401 || response.status === 403 ? "authentication" : response.status >= 500 ? "server" : "http_error",
        });
        if (isAuthoritativeSessionRejection(response.status)) {
          await clearTokens();
          return "invalid";
        }
        return { kind: "unavailable", status: response.status, code };
      }
      const tokens = await response.json();
      await storeTokens(tokens);
      await rotateOfflineSessionToken(refreshToken, tokens.refreshToken);
      return "refreshed";
    } catch (error) {
      if (error instanceof ApiTransportError) return error;
      // SecureStore/JSON/token persistence failures are local or unexpected,
      // not an HTTP 503. Never invent a backend response for these failures.
      if (__DEV__) console.error("Digital-Khata session refresh failed", {
        origin,
        location: "refresh_session_processing",
        category: "local_or_unexpected",
        code: "SESSION_PROCESSING_FAILED",
        stack: error instanceof Error ? error.stack?.split("\n").slice(1)
          .flatMap((line) => {
            const frame = line.match(/[/\\]([\w.-]+\.(?:js|ts|tsx|bundle)):(\d+):(\d+)/);
            return frame ? [`at ${frame[1]}:${frame[2]}:${frame[3]}`] : [];
          }).slice(0, 15).join("\n") : undefined,
      });
      throw error;
    } finally {
      refreshJob = null;
    }
  })();
  return refreshJob;
}
async function storeTokens(value: {
  accessToken: string;
  refreshToken: string;
}) {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS, value.accessToken),
    SecureStore.setItemAsync(REFRESH, value.refreshToken),
  ]);
}
export async function clearTokens() {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS),
    SecureStore.deleteItemAsync(REFRESH),
    clearOfflineSession(),
  ]);
}

export async function clearOfflineAuthorization() {
  await clearTokens();
}
export async function restoreSession(): Promise<Data | null> {
  if (!(await SecureStore.getItemAsync(REFRESH))) return null;
  const refreshed = await refresh("session_restore");
  if (refreshed instanceof ApiTransportError) throw refreshed;
  // A temporary auth-service/backend outage is not proof that the stored
  // account session is invalid. Let App startup try the existing offline
  // session and encrypted cache. Only explicit 401/403 responses clear it.
  if (typeof refreshed === "object" && refreshed.kind === "unavailable")
    throw new ApiError("Could not restore the online session", refreshed.status, { code: refreshed.code });
  if (refreshed !== "refreshed") return null;
  return loadAccount("session_restore");
}
export async function loadAccount(origin: RequestOrigin = "foreground"): Promise<Data> {
  const base = (await request("/bootstrap", {}, true, origin)) as Data;
  if (!base || typeof base !== "object" || !base.shop || typeof base.shop !== "object")
    throw new ApiError("The server returned invalid account data", 502, { code: "INVALID_SERVER_RESPONSE" });
  if (base.shopExists === false)
    return normalizeData({ ...base, customers: [], entries: [], audit: [] });
  const pages = async <T>(path: string): Promise<T[]> => {
    const rows: T[] = [];
    let cursor = "";
    do {
      const query = new URLSearchParams({
        limit: "500",
        ...(cursor ? { cursor } : {}),
      });
      const page = (await request(`${path}?${query}`, {}, true, origin)) as {
        items: T[];
        nextCursor: string | null;
      };
      if (!page || !Array.isArray(page.items) || (page.nextCursor != null && typeof page.nextCursor !== "string")) {
        if (__DEV__) console.warn("Digital-Khata account response invalid", {
          method: "GET", endpoint: path, code: "INVALID_SERVER_RESPONSE",
          responseReceived: true, origin, category: "invalid_response",
        });
        throw new ApiError("The server returned invalid account data", 502, { code: "INVALID_SERVER_RESPONSE" });
      }
      rows.push(...page.items);
      cursor = page.nextCursor || "";
    } while (cursor);
    return rows;
  };
  const [customers, entries, audit] = await Promise.all([
    pages<Data["customers"][number]>("/customers"),
    pages<Data["entries"][number]>("/ledger"),
    pages<Data["audit"][number]>("/activity"),
  ]);
  try {
    return normalizeData({ ...base, customers, entries, audit });
  } catch {
    if (__DEV__) console.warn("Digital-Khata account response invalid", {
      method: "GET", endpoint: "/account/normalize", code: "INVALID_SERVER_RESPONSE",
      responseReceived: true, origin, category: "invalid_response",
    });
    throw new ApiError("The server returned invalid account data", 502, { code: "INVALID_SERVER_RESPONSE" });
  }
}
export function normalizeData(value: Data): Data {
  return {
    ...value,
    customers: value.customers.map((customer) => normalizeCustomerLifecycle(customer) as Data["customers"][number]),
    shopExists: value.shopExists ?? true,
    shopComplete: value.shopComplete ?? Boolean(value.shop.name.trim() && value.shop.owner.trim()),
    shop: { ...value.shop, phone: value.shop.phone.replace(/^\+91/, "") },
    entries: value.entries.map((entry) => withoutLegacyDue(entry) as Data["entries"][number]),
    audit: value.audit.map((item) => withoutLegacyDueFromAudit(item)),
  };
}
export async function startOtp(phone: string) {
  return request(
    "/auth/otp/start",
    { method: "POST", body: JSON.stringify({ phone }) },
    false,
  );
}
export async function verifyOtp(phone: string, code: string): Promise<Data> {
  const tokens = await request(
    "/auth/otp/verify",
    { method: "POST", body: JSON.stringify({ phone, code }) },
    false,
  );
  await storeTokens(tokens);
  try {
    return await loadAccount();
  } catch (cause) {
    throw new OtpVerifiedAccountLoadError(cause);
  }
}
export async function registerShop(input: {
  name: string;
  owner: string;
  address: string;
  whatsapp: string;
  language: string;
  referralCode?: string;
}): Promise<Data> {
  await request("/shop/register", { method: "POST", body: JSON.stringify(input) });
  return loadAccount();
}
export type ReferralWalletSnapshot = {
  shopId: string;
  referralCode: string;
  referralUrlPath: string;
  wallet: {
    balanceMinor: number;
    availableMinor: number;
    currency: "INR";
    items: Array<{ id: string; direction: "credit" | "debit"; amountMinor: number; reason: string; description: string; createdAt: string }>;
    nextCursor: string | null;
  };
  referrals: {
    counts: { pending: number; rewarded: number; rejected: number };
    items: Array<{ id: string; role: string; status: string; requiredCustomers: number; rewardMinor: number; qualifiedAt: string | null; createdAt: string }>;
    nextCursor: string | null;
  };
};
export async function getReferralWalletSnapshot(): Promise<ReferralWalletSnapshot> {
  return request("/referral/summary?limit=20") as Promise<ReferralWalletSnapshot>;
}
export async function logout() {
  const refreshToken = await SecureStore.getItemAsync(REFRESH);
  try {
    await request(
      "/auth/logout",
      { method: "POST", body: JSON.stringify({ refreshToken }) },
      false,
    );
  } finally {
    await clearTokens();
  }
}
export async function deleteAccount() {
  await request("/account/delete", {
    method: "POST",
    body: JSON.stringify({ confirm: "DELETE" }),
  });
  await clearTokens();
}
export async function restoreBackup(data: Data) {
  await request("/backup/restore", {
    method: "POST",
    body: JSON.stringify({
      ...normalizeData(data),
      shop: {
        ...data.shop,
        phone: data.shop.phone.startsWith("+")
          ? data.shop.phone
          : `+91${data.shop.phone}`,
      },
    }),
  });
  return loadAccount();
}
export async function getNotifications() {
  return request("/notifications") as Promise<{
    items: {
      id: string;
      title: string;
      body: string;
      read: boolean;
      date: string;
    }[];
  }>;
}
export async function markNotificationsRead(ids: string[]) {
  return request("/notifications/read", {
    method: "PATCH",
    body: JSON.stringify({ ids }),
  });
}
export async function registerPushToken(
  token: string,
  platform: "android" | "ios" | "web",
) {
  return request("/devices/push-token", {
    method: "POST",
    body: JSON.stringify({ token, platform }),
  });
}

export async function getSubscriptionSnapshot(): Promise<SubscriptionSnapshot> {
  const [plans, current, history, payments] = await Promise.all([
    request("/subscription/plans"),
    request("/subscription/current"),
    request("/subscription/history?limit=15"),
    request("/subscription/payments?limit=15"),
  ]);
  return {
    plans: plans.items,
    current,
    history: history.items,
    historyNextCursor: history.nextCursor,
    payments: payments.items,
    paymentsNextCursor: payments.nextCursor,
    checkoutEnabled: plans.checkoutEnabled === true,
    provider: plans.provider,
  };
}

export async function getSubscriptionHistory(cursor: string, limit = 15) {
  const query = new URLSearchParams({ limit: String(limit), cursor });
  return request(`/subscription/history?${query.toString()}`) as Promise<{
    items: SubscriptionSnapshot["history"];
    nextCursor: string | null;
  }>;
}

export async function getSubscriptionPayments(cursor: string, limit = 15) {
  const query = new URLSearchParams({ limit: String(limit), cursor });
  return request(`/subscription/payments?${query.toString()}`) as Promise<{
    items: any[];
    nextCursor: string | null;
  }>;
}

export async function createSubscriptionCheckout(input: {
  planCode: "pro" | "business";
  durationMonths: number;
  acceptedPricingVersion: number;
  idempotencyKey: string;
  useWallet?: boolean;
}) {
  return request("/subscription/checkout", {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      planCode: input.planCode,
      durationMonths: input.durationMonths,
      acceptedPricingVersion: input.acceptedPricingVersion,
      useWallet: input.useWallet === true,
    }),
  });
}

export async function verifySubscriptionPayment(input: { orderId: string }) {
  return request("/payments/verify", { method: "POST", body: JSON.stringify(input) });
}

export async function getSubscriptionPaymentStatus(orderId: string): Promise<{
  id: string;
  status: "created" | "pending" | "paid" | "failed";
  amountMinor: number;
  totalAmountMinor?: number;
  walletAppliedMinor?: number;
  currency: string;
  paymentId?: string | null;
  subscription?: SubscriptionSnapshot["current"];
}> {
  return request(`/payments/${encodeURIComponent(orderId)}/status`);
}

export async function getSubscriptionPaymentAttemptStatus(idempotencyKey: string): Promise<{
  id: string;
  status: "created" | "pending" | "paid" | "failed";
  amountMinor: number;
  currency: string;
}> {
  return request(`/payments/attempts/${encodeURIComponent(idempotencyKey)}/status`);
}
export async function syncQueuedChange(change: SyncDelta) {
  change = normalizeSyncDelta(change);
  const acknowledged: { customers: Data["customers"]; entries: Data["entries"]; settings?: SyncSettings } = {
    customers: [],
    entries: [],
  };
  if (!(await SecureStore.getItemAsync(ACCESS)))
    throw new ApiError("Sign-in is required to synchronize changes", 401);
  const syncRequest = (path: string, options: RequestInit = {}) =>
    request(path, options, true, "offline_sync");
  if (change.settings) {
    const settings = change.settings.after;
    const base = change.settings.before;
    const payload = (value: typeof settings) => ({
      name: value.shop.name,
      owner: value.shop.owner,
      address: value.shop.address,
      phone: value.shop.phone.startsWith("+") ? value.shop.phone : `+91${value.shop.phone}`,
      whatsapp: value.shop.whatsapp,
      defaultMethod: value.defaultMethod,
      reminders: value.reminders,
    });
    const saved = await syncRequest("/shop", {
      method: "PATCH",
      body: JSON.stringify({
        ...payload(settings),
        baseSettings: payload(base),
        ...(base.shop.serverVersion ? { baseVersion: base.shop.serverVersion } : {}),
        ...(base.shop.resolutionVersion ? { baseResolutionVersion: base.shop.resolutionVersion } : {}),
      }),
    }) as Record<string, any>;
    acknowledged.settings = {
      shop: { name: saved.name, owner: saved.owner, address: saved.address, phone: String(saved.phone).replace(/^\+91/, ""), whatsapp: saved.whatsapp, serverVersion: saved.serverVersion, resolutionVersion: saved.resolutionVersion },
      // Language is a device-local preference, not part of this server update.
      language: settings.language,
      defaultMethod: saved.defaultMethod,
      reminders: saved.reminders,
    };
  }
  const customerAudit = change.audit.find((item) =>
    item.action.toLowerCase().includes("customer"),
  );
  for (const item of change.customers) {
    const customer = item.after;
    const old = item.before;
    if (item.operation === "lifecycle" && customer && old) {
      const event = change.audit.find((record) => record.action.startsWith("CUSTOMER_"));
      const operationId = event?.id || `lifecycle-${customer.id}-${old.serverVersion || 1}-${customer.status ? "active" : customer.disabled ? "disabled" : "removed"}`;
      const saved = await syncRequest(`/customers/${encodeURIComponent(customer.id)}/lifecycle`, {
        method: "PATCH",
        headers: { "Idempotency-Key": `customer-lifecycle:${operationId}` },
        body: JSON.stringify({
          target: customer.status ? "active" : customer.disabled ? "disabled" : "removed",
          operationId,
          baseVersion: old.serverVersion || 1,
          baseResolutionVersion: old.resolutionVersion || 1,
          ...(event?.after && "reason" in event.after ? { reason: (event.after as any).reason } : {}),
        }),
      }) as Data["customers"][number];
      acknowledged.customers.push(normalizeCustomerLifecycle(saved) as Data["customers"][number]);
      continue;
    }
    if (!customer) {
      const baseRecord = { ...old! };
      delete baseRecord.createdAt;
      delete baseRecord.serverVersion;
      delete baseRecord.resolutionVersion;
      await syncRequest(`/customers/${encodeURIComponent(old!.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ baseRecord, ...(old?.serverVersion ? { baseVersion: old.serverVersion } : {}), ...(old?.resolutionVersion ? { baseResolutionVersion: old.resolutionVersion } : {}), ...(customerAudit ? { audit: auditInput(customerAudit) } : {}) }),
      });
      continue;
    }
    const customerInput = { ...customer };
    customerInput.openingDate ??= customer.createdAt?.slice(0, 10);
    if (old) delete customerInput.createdAt;
    delete customerInput.serverVersion;
    delete customerInput.resolutionVersion;
    const baseRecord = old ? { ...old } : undefined;
    if (baseRecord) {
      delete baseRecord.createdAt;
      delete baseRecord.serverVersion;
      delete baseRecord.resolutionVersion;
    }
    const saved = await syncRequest(
      old ? `/customers/${encodeURIComponent(customer.id)}` : "/customers",
      {
        method: old ? "PATCH" : "POST",
        body: JSON.stringify({
          ...customerInput,
          ...(baseRecord ? { baseRecord } : {}),
          ...(old?.serverVersion ? { baseVersion: old.serverVersion } : {}),
          ...(old?.resolutionVersion ? { baseResolutionVersion: old.resolutionVersion } : {}),
          ...(customerAudit ? { audit: auditInput(customerAudit) } : {}),
        }),
      },
    );
    acknowledged.customers.push(saved);
  }
  for (const item of change.entries) {
    const entry = item.after;
    const old = item.before;
    const action = change.audit.find(
      (audit) => audit.after?.id === (entry || old)?.id || audit.before?.id === (entry || old)?.id,
    );
    if (!entry) {
      await syncRequest(`/ledger/${encodeURIComponent(old!.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ baseRecord: (() => { const value = { ...old! }; delete value.serverVersion; delete value.resolutionVersion; return value; })(), ...(old?.serverVersion ? { baseVersion: old.serverVersion } : {}), ...(old?.resolutionVersion ? { baseResolutionVersion: old.resolutionVersion } : {}), ...(action ? { audit: auditInput(action) } : {}) }),
      });
      continue;
    }
    const baseRecord = old ? { ...old } : undefined;
    const baseVersion = baseRecord?.serverVersion;
    const baseResolutionVersion = baseRecord?.resolutionVersion;
    if (baseRecord) delete baseRecord.serverVersion;
    if (baseRecord) delete baseRecord.resolutionVersion;
    const payload = { ...withoutLegacyDue(entry) };
    delete payload.serverVersion;
    delete payload.resolutionVersion;
    const saved = await syncRequest(old ? `/ledger/${encodeURIComponent(entry.id)}` : "/ledger", {
      method: old ? "PATCH" : "POST",
      headers: old ? {} : {
        "Idempotency-Key": entry.id,
        ...(change.recordedAtAuthority === "server" ? { "X-DK-Recorded-At-Authority": "server" } : {}),
      },
      body: JSON.stringify({
        ...payload,
        ...(baseRecord ? { baseRecord, ...(baseVersion ? { baseVersion } : {}) } : {}),
        ...(baseResolutionVersion ? { baseResolutionVersion } : {}),
        ...(action ? { audit: auditInput(action) } : {}),
      }),
    });
    acknowledged.entries.push(saved);
  }
  if (change.read.length)
    await syncRequest("/activity/read", {
      method: "PATCH",
      body: JSON.stringify({ ids: change.read }),
    });
  return acknowledged;
}

export async function resolveFinancialConflict(
  conflict: PendingConflict,
  choice: "keep_local" | "keep_server",
) {
  const proposed = { ...conflict.local };
  delete proposed.serverVersion;
  delete proposed.resolutionVersion;
  return request(`/ledger/${encodeURIComponent(conflict.entryId)}/resolve`, {
    method: "POST",
    headers: { "Idempotency-Key": conflict.resolutionId },
    body: JSON.stringify({
      resolutionId: conflict.resolutionId,
      expectedVersion: conflict.expectedVersion,
      expectedResolutionVersion: conflict.expectedResolutionVersion,
      choice,
      proposed,
      localDeleted: conflict.localDeleted,
      localAt: conflict.localAt,
    }),
  }) as Promise<{ entry: PendingConflict["server"]; serverVersion: number; resolutionVersion: number; resolutionId: string; serverAt: string; audit: Data["audit"][number] }>;
}

export async function resolveCustomerConflict(
  conflict: import("./offlineStore").PendingCustomerConflict,
  choice: "keep_local" | "keep_server",
) {
  const proposed = { ...conflict.local };
  delete proposed.createdAt;
  delete proposed.serverVersion;
  delete proposed.resolutionVersion;
  return request(`/customers/${encodeURIComponent(conflict.customerId)}/resolve`, {
    method: "POST",
    headers: { "Idempotency-Key": `customer-resolution:${conflict.resolutionId}` },
    body: JSON.stringify({
      resolutionId: conflict.resolutionId,
      expectedVersion: conflict.expectedVersion,
      expectedResolutionVersion: conflict.expectedResolutionVersion,
      choice,
      proposed,
      localDeleted: conflict.localDeleted,
      lifecycleChange: conflict.lifecycleChange || false,
      localAt: conflict.localAt,
    }),
  }) as Promise<{
    customer: Data["customers"][number] | null;
    serverVersion: number;
    resolutionVersion: number;
    resolutionId: string;
    serverAt: string;
    audit: Data["audit"][number];
  }>;
}

export async function resolveSettingsConflict(conflict: PendingSettingsConflict, choice: "keep_local" | "keep_server") {
  const proposed = {
    ...conflict.local.shop,
    phone: conflict.local.shop.phone.startsWith("+") ? conflict.local.shop.phone : `+91${conflict.local.shop.phone}`,
    defaultMethod: conflict.local.defaultMethod,
    reminders: conflict.local.reminders,
  };
  delete (proposed as Partial<Data["shop"]>).serverVersion;
  delete (proposed as Partial<Data["shop"]>).resolutionVersion;
  const result = await request("/shop/resolve", {
    method: "POST",
    headers: { "Idempotency-Key": `shop-resolution:${conflict.resolutionId}` },
    body: JSON.stringify({
      resolutionId: conflict.resolutionId,
      expectedVersion: conflict.expectedVersion,
      expectedResolutionVersion: conflict.expectedResolutionVersion,
      choice,
      proposed,
      localAt: conflict.localAt,
    }),
  }) as { settings: SyncSettings; serverVersion: number; resolutionVersion: number; resolutionId: string; serverAt: string; audit: Data["audit"][number] };
  result.settings.shop.phone = result.settings.shop.phone.replace(/^\+91/, "");
  return result;
}

export async function syncChange(previous: Data, next: Data, recordedAtAuthority?: "server") {
  if (!previous.signedIn || !(await SecureStore.getItemAsync(ACCESS))) return;
  return syncQueuedChange({
    ...createSyncDelta(previous, next),
    ...(recordedAtAuthority ? { recordedAtAuthority } : {}),
  });
}
