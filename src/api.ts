import * as SecureStore from "expo-secure-store";
import type { Data } from "./model";

const BASE = (
  process.env.EXPO_PUBLIC_API_URL || "http://10.0.2.2:4000/api/v1"
).replace(/\/$/, "");
const ACCESS = "khata.access.v1";
const REFRESH = "khata.refresh.v1";
let refreshJob: Promise<boolean> | null = null;

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
  if (
    response.status === 401 &&
    retry &&
    path !== "/auth/refresh" &&
    (await refresh())
  )
    return request(path, options, false);
  if (response.status === 204) return undefined;
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(value.error || `Server error (${response.status})`);
  return value;
}
async function refresh(): Promise<boolean> {
  if (refreshJob) return refreshJob;
  refreshJob = (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH);
      if (!refreshToken) return false;
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        await clearTokens();
        return false;
      }
      await storeTokens(await response.json());
      return true;
    } catch {
      return false;
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
  ]);
}
export async function restoreSession(): Promise<Data | null> {
  if (!(await SecureStore.getItemAsync(REFRESH))) return null;
  if (!(await refresh())) return null;
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
export async function syncChange(previous: Data, next: Data) {
  if (!previous.signedIn || !(await SecureStore.getItemAsync(ACCESS))) return;
  if (
    JSON.stringify(previous.shop) !== JSON.stringify(next.shop) ||
    previous.language !== next.language ||
    previous.defaultMethod !== next.defaultMethod ||
    JSON.stringify(previous.reminders) !== JSON.stringify(next.reminders)
  ) {
    await request("/shop", {
      method: "PATCH",
      body: JSON.stringify({
        ...next.shop,
        phone: next.shop.phone.startsWith("+")
          ? next.shop.phone
          : `+91${next.shop.phone}`,
        language: next.language,
        defaultMethod: next.defaultMethod,
        reminders: next.reminders,
      }),
    });
  }
  const priorCustomers = new Map(previous.customers.map((x) => [x.id, x]));
  for (const customer of next.customers) {
    const old = priorCustomers.get(customer.id);
    if (JSON.stringify(old) === JSON.stringify(customer)) continue;
    const action = next.audit.find(
      (a) =>
        !previous.audit.some((p) => p.id === a.id) &&
        a.action.toLowerCase().includes("customer"),
    );
    await request(
      old ? `/customers/${encodeURIComponent(customer.id)}` : "/customers",
      {
        method: old ? "PATCH" : "POST",
        body: JSON.stringify({
          ...customer,
          ...(action ? { audit: action } : {}),
        }),
      },
    );
  }
  const priorEntries = new Map(previous.entries.map((x) => [x.id, x]));
  for (const entry of next.entries) {
    const old = priorEntries.get(entry.id);
    if (JSON.stringify(old) === JSON.stringify(entry)) continue;
    const action = next.audit.find(
      (a) =>
        !previous.audit.some((p) => p.id === a.id) &&
        (a.after?.id === entry.id ||
          a.action === "Edited transaction" ||
          a.action.startsWith("Recorded")),
    );
    await request(old ? `/ledger/${encodeURIComponent(entry.id)}` : "/ledger", {
      method: old ? "PATCH" : "POST",
      headers: old ? {} : { "Idempotency-Key": entry.id },
      body: JSON.stringify({ ...entry, ...(action ? { audit: action } : {}) }),
    });
  }
  for (const entry of previous.entries) {
    if (!next.entries.some((e) => e.id === entry.id)) {
      const action = next.audit.find(
        (a) =>
          !previous.audit.some((p) => p.id === a.id) &&
          a.action === "Deleted transaction",
      );
      await request(`/ledger/${encodeURIComponent(entry.id)}`, {
        method: "DELETE",
        body: JSON.stringify(action ? { audit: action } : {}),
      });
    }
  }
  const newReads = next.read.filter((id) => !previous.read.includes(id));
  if (newReads.length)
    await request("/activity/read", {
      method: "PATCH",
      body: JSON.stringify({ ids: newReads }),
    });
}
