import type { Envelope } from "../../types/admin";
export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function adminRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    csrf?: string;
  } = {},
): Promise<Envelope<T>> {
  let response: Response;
  try {
    response = await fetch(`/admin/api/${path}`, {
      method: options.method || "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.csrf ? { "x-admin-csrf": options.csrf } : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new AdminApiError(
      0,
      "NETWORK_UNAVAILABLE",
      "Check your connection and try again.",
    );
  }
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    if (
      response.status === 401 &&
      ["ADMIN_SESSION_REQUIRED", "ADMIN_SESSION_EXPIRED"].includes(
        value?.error?.code,
      )
    )
      window.dispatchEvent(new Event("admin-session-expired"));
    throw new AdminApiError(
      response.status,
      value?.error?.code || "ADMIN_REQUEST_FAILED",
      value?.error?.message || "The request could not be completed.",
    );
  }
  if (!value || !("data" in value))
    throw new AdminApiError(
      502,
      "ADMIN_INVALID_RESPONSE",
      "The service returned an invalid response.",
    );
  return value;
}
export const money = (minor: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100);
export const date = (value: unknown) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(value))
    : "—";
