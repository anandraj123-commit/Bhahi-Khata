export type StoredSubscriptionPaymentAttempt = {
  orderId?: string;
  idempotencyKey?: string;
  gatewayOrderId?: string;
  shopId?: string;
  planCode?: string;
  months?: number;
  pricingVersion?: number;
  useWallet?: boolean;
};

/** Copy legacy state without deleting it; a failed marker write is safe to retry.
 * Callers serialize initialization for each backend-scoped key. */
export async function migratePaymentStorageKey(key: string, legacyKey: string,
  read: (key: string) => Promise<string | null>, write: (key: string, value: string) => Promise<unknown>) {
  const marker = `${key}.migrated`;
  if (!await read(marker)) {
    const legacy = await read(legacyKey);
    if (legacy && !await read(key)) await write(key, legacy);
    await write(marker, "1");
  }
  return key;
}

export type SubscriptionPaymentAttemptStatus = {
  id?: string;
  status: "created" | "pending" | "paid" | "failed";
  orderStatus?: string;
  attemptStatus?: string;
  latestPaymentStatus?: string;
  requiresReview?: boolean;
  hasPendingAttempts?: boolean;
};

export type PendingAttemptResolution =
  | { kind: "none" }
  | { kind: "different-shop" }
  | { kind: "unverified" }
  | { kind: "pending"; status: SubscriptionPaymentAttemptStatus }
  | { kind: "paid"; status: SubscriptionPaymentAttemptStatus }
  | { kind: "failed"; status: SubscriptionPaymentAttemptStatus };

/** Verify a locally remembered checkout before it can block a different purchase. */
export async function resolvePendingSubscriptionPayment({
  pending,
  currentShopId,
  getOrderStatus,
  getAttemptStatus,
  clear,
}: {
  pending: StoredSubscriptionPaymentAttempt | null;
  currentShopId: string;
  getOrderStatus: (orderId: string) => Promise<SubscriptionPaymentAttemptStatus>;
  getAttemptStatus: (idempotencyKey: string) => Promise<SubscriptionPaymentAttemptStatus>;
  clear: () => Promise<unknown>;
}): Promise<PendingAttemptResolution> {
  if (!pending) return { kind: "none" };
  if (pending.shopId && pending.shopId !== currentShopId)
    return { kind: "different-shop" };
  if (!pending.orderId && !pending.idempotencyKey) {
    return { kind: "unverified" };
  }

  let status: SubscriptionPaymentAttemptStatus;
  try {
    status = pending.orderId
      ? await getOrderStatus(pending.orderId)
      : await getAttemptStatus(pending.idempotencyKey!);
  } catch (error) {
    // A 404 is not a final payment status (including across environments).
    if ((error as { status?: number } | null)?.status === 404)
      return { kind: "unverified" };
    throw error;
  }

  if (status.status === "failed" && status.hasPendingAttempts) return { kind: "pending", status };
  if (status.status === "paid" || status.status === "failed") {
    if (status.status === "failed") await clear();
    return { kind: status.status, status };
  }
  return { kind: "pending", status };
}

/** Secure storage failures must never masquerade as gateway failures. */
export class PaymentLocalSyncError extends Error {
  constructor() { super("Local payment synchronization failed"); }
}

export async function paymentStorage<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch { throw new PaymentLocalSyncError(); }
}

export function parsePaymentAttempt(raw: string | null): StoredSubscriptionPaymentAttempt | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        (value.orderId !== undefined && typeof value.orderId !== "string") ||
        (value.idempotencyKey !== undefined && typeof value.idempotencyKey !== "string"))
      throw new Error("Invalid saved attempt");
    return value;
  } catch { throw new PaymentLocalSyncError(); }
}

/** Called only after the backend establishes paid status. Cache is not payment truth. */
export async function finishVerifiedPayment(refresh: () => Promise<boolean>, clear: () => Promise<unknown>) {
  try {
    if (!await refresh()) return false;
    await clear();
    return true;
  } catch { return false; }
}

export function paymentProblem(problem: unknown, stage: "saved-attempt" | "checkout" | "verification") {
  if (problem instanceof PaymentLocalSyncError)
    return ["Local synchronization failed", "The device could not read or save the payment reference. Existing references were retained. Refresh before trying again."] as const;
  const error = problem as { kind?: string; status?: number; payload?: { error?: string } } | null;
  if (error?.kind === "network" || error?.kind === "timeout")
    return ["Network unavailable", "Payment status could not be confirmed. Any saved payment reference is retained. Refresh to verify before paying again."] as const;
  if (stage === "checkout" && error?.status && error.status < 500)
    return ["Checkout unavailable", error.payload?.error || "The server did not authorize checkout. Refresh your subscription details."] as const;
  return ["Payment pending verification", "The server could not establish the final payment status. Your saved reference is retained. Refresh before paying again."] as const;
}

/** A missing response may be retried only as the exact same idempotent purchase. */
export function canReplaySubscriptionAttempt(
  pending: StoredSubscriptionPaymentAttempt | null,
  purchase: { shopId: string; planCode: string; months: number; useWallet: boolean },
) {
  return !!pending && !pending.orderId && !!pending.idempotencyKey &&
    pending.shopId === purchase.shopId && pending.planCode === purchase.planCode &&
    pending.months === purchase.months && (pending.useWallet === true) === purchase.useWallet;
}

/** Append before replacing the working reference; failed attempts may belong to ACTIVE orders. */
export async function retainPaymentReference(
  pending: StoredSubscriptionPaymentAttempt | null,
  read: () => Promise<string | null>,
  write: (value: string) => Promise<unknown>,
) {
  if (!pending) return;
  const raw = await paymentStorage(read);
  let references: StoredSubscriptionPaymentAttempt[] = [];
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error();
      references = parsed.map(item => parsePaymentAttempt(JSON.stringify(item))!);
    } catch { throw new PaymentLocalSyncError(); }
  }
  const index = references.findIndex(item => item.shopId === pending.shopId &&
    ((!!pending.orderId && item.orderId === pending.orderId) || (!!pending.idempotencyKey && item.idempotencyKey === pending.idempotencyKey)));
  if (index >= 0) references[index] = { ...references[index], ...pending };
  else references.push(pending);
  await paymentStorage(() => write(JSON.stringify(references)));
}

/** Provider attempt state is separate from the still-open Cashfree order. */
export function paymentStatusMessage(status: Pick<SubscriptionPaymentAttemptStatus, "status" | "latestPaymentStatus">): string {
  if (status.status === "paid") return "Payment successful";
  if (["USER_DROPPED", "CANCELLED", "VOID"].includes(status.latestPaymentStatus || "")) return "Payment Not Completed";
  return status.status === "failed" ? "Payment Failed" : "Payment pending verification";
}
