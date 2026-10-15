import * as SecureStore from "expo-secure-store";
import {
  clearOfflineSession,
  rotateOfflineSessionToken,
} from "./offlineStore";
import type { Data } from "./model";
import type { PendingConflict } from "./offlineStore";
import { createSyncDelta, type SyncDelta } from "./syncDelta";

const BASE = (
  process.env.EXPO_PUBLIC_API_URL || "http://10.0.2.2:4000/api/v1"
).replace(/\/$/, "");
const ACCESS = "khata.access.v1";
const REFRESH = "khata.refresh.v1";
const auditInput = (audit: Data["audit"][number]) => {
  const before = audit.before ? { ...audit.before } : undefined;
  const after = audit.after ? { ...audit.after } : undefined;
  if (before) delete before.serverVersion;
  if (after) delete after.serverVersion;
  return { ...audit, ...(before ? { before } : {}), ...(after ? { after } : {}) };
};
type RefreshResult = "refreshed" | "invalid" | "unavailable";
let refreshJob: Promise<RefreshResult> | null = null;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload?: any) {
    super(message);
    this.name = "ApiError";
  }
}

async function request(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<any> {
  const access = await SecureStore.getItemAsync(ACCESS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
        ...options.headers,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 401 && retry && path !== "/auth/refresh") {
    const refreshed = await refresh();
    if (refreshed === "refreshed") return request(path, options, false);
    if (refreshed === "unavailable")
      throw new ApiError("Could not validate the server session", 503);
  }
  if (response.status === 204) return undefined;
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(value.error || `Server error (${response.status})`, response.status, value);
  return value;
}
async function refresh(): Promise<RefreshResult> {
  if (refreshJob) return refreshJob;
  refreshJob = (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH);
      if (!refreshToken) return "invalid";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      let response: Response;
      try {
        response = await fetch(`${BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          await clearTokens();
          return "invalid";
        }
        return "unavailable";
      }
      const tokens = await response.json();
      await storeTokens(tokens);
      await rotateOfflineSessionToken(refreshToken, tokens.refreshToken);
      return "refreshed";
    } catch {
      return "unavailable";
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
  if ((await refresh()) !== "refreshed") return null;
  return loadAccount();
}
export async function loadAccount(): Promise<Data> {
  const base = (await request("/bootstrap")) as Data;
  const pages = async <T>(path: string): Promise<T[]> => {
    const rows: T[] = [];
    let cursor = "";
    do {
      const query = new URLSearchParams({
        limit: "500",
        ...(cursor ? { cursor } : {}),
      });
      const page = (await request(`${path}?${query}`)) as {
        items: T[];
        nextCursor: string | null;
      };
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
  return normalizeData({ ...base, customers, entries, audit });
}
export function normalizeData(value: Data): Data {
  return {
    ...value,
    shop: { ...value.shop, phone: value.shop.phone.replace(/^\+91/, "") },
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
  return loadAccount();
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
      ...data,
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
export async function syncQueuedChange(change: SyncDelta) {
  if (!(await SecureStore.getItemAsync(ACCESS)))
    throw new ApiError("Sign-in is required to synchronize changes", 401);
  if (change.settings) {
    const settings = change.settings.after;
    const base = change.settings.before;
    const payload = (value: typeof settings) => ({
      ...value.shop,
      phone: value.shop.phone.startsWith("+")
        ? value.shop.phone
        : `+91${value.shop.phone}`,
      language: value.language,
      defaultMethod: value.defaultMethod,
      reminders: value.reminders,
    });
    await request("/shop", {
      method: "PATCH",
      body: JSON.stringify({ ...payload(settings), baseSettings: payload(base) }),
    });
  }
  const customerAudit = change.audit.find((item) =>
    item.action.toLowerCase().includes("customer"),
  );
  for (const item of change.customers) {
    const customer = item.after;
    const old = item.before;
    if (!customer) {
      const baseRecord = { ...old! };
      delete baseRecord.createdAt;
      await request(`/customers/${encodeURIComponent(old!.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ baseRecord }),
      });
      continue;
    }
    const customerInput = { ...customer };
    delete customerInput.createdAt;
    const baseRecord = old ? { ...old } : undefined;
    if (baseRecord) delete baseRecord.createdAt;
    await request(
      old ? `/customers/${encodeURIComponent(customer.id)}` : "/customers",
      {
        method: old ? "PATCH" : "POST",
        body: JSON.stringify({
          ...customerInput,
          ...(baseRecord ? { baseRecord } : {}),
          ...(customerAudit ? { audit: auditInput(customerAudit) } : {}),
        }),
      },
    );
  }
  for (const item of change.entries) {
    const entry = item.after;
    const old = item.before;
    const action = change.audit.find(
      (audit) => audit.after?.id === (entry || old)?.id || audit.before?.id === (entry || old)?.id,
    );
    if (!entry) {
      await request(`/ledger/${encodeURIComponent(old!.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ baseRecord: (() => { const value = { ...old! }; delete value.serverVersion; return value; })(), ...(old?.serverVersion ? { baseVersion: old.serverVersion } : {}), ...(action ? { audit: auditInput(action) } : {}) }),
      });
      continue;
    }
    const baseRecord = old ? { ...old } : undefined;
    const baseVersion = baseRecord?.serverVersion;
    if (baseRecord) delete baseRecord.serverVersion;
    const payload = { ...entry };
    delete payload.serverVersion;
    await request(old ? `/ledger/${encodeURIComponent(entry.id)}` : "/ledger", {
      method: old ? "PATCH" : "POST",
      headers: old ? {} : { "Idempotency-Key": entry.id },
      body: JSON.stringify({
        ...payload,
        ...(baseRecord ? { baseRecord, ...(baseVersion ? { baseVersion } : {}) } : {}),
        ...(action ? { audit: auditInput(action) } : {}),
      }),
    });
  }
  if (change.read.length)
    await request("/activity/read", {
      method: "PATCH",
      body: JSON.stringify({ ids: change.read }),
    });
}

export async function resolveFinancialConflict(
  conflict: PendingConflict,
  choice: "keep_local" | "keep_server",
) {
  const proposed = { ...conflict.local };
  delete proposed.serverVersion;
  return request(`/ledger/${encodeURIComponent(conflict.entryId)}/resolve`, {
    method: "POST",
    headers: { "Idempotency-Key": conflict.resolutionId },
    body: JSON.stringify({
      resolutionId: conflict.resolutionId,
      expectedVersion: conflict.expectedVersion,
      choice,
      proposed,
      localDeleted: conflict.localDeleted,
      localAt: conflict.localAt,
    }),
  }) as Promise<{ entry: PendingConflict["server"]; serverVersion: number; resolutionId: string; serverAt: string; audit: Data["audit"][number] }>;
}

export async function syncChange(previous: Data, next: Data) {
  if (!previous.signedIn || !(await SecureStore.getItemAsync(ACCESS))) return;
  return syncQueuedChange(createSyncDelta(previous, next));
}
