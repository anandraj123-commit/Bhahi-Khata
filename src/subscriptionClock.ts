export type SubscriptionClockAnchor = { shopId: string; observedAt: number };

export function evaluateOfflineSubscriptionClock(input: {
  now: number;
  shopId: string;
  anchor: SubscriptionClockAnchor | null;
  cachedAt?: number;
}) {
  const { now, shopId, anchor, cachedAt } = input;
  const baseline = anchor
    ? anchor.shopId === shopId && Number.isFinite(anchor.observedAt)
      ? anchor.observedAt
      : null
    : Number.isFinite(cachedAt) ? Number(cachedAt) : null;
  const safe = baseline !== null && now >= baseline;
  return {
    safe,
    nextAnchor: safe ? { shopId, observedAt: Math.max(now, baseline) } : null,
  };
}

export function mergeVerifiedSubscriptionClockAnchor(
  anchor: SubscriptionClockAnchor | null,
  shopId: string,
  now: number,
): SubscriptionClockAnchor {
  return {
    shopId,
    observedAt: anchor?.shopId === shopId && Number.isFinite(anchor.observedAt)
      ? Math.max(anchor.observedAt, now)
      : now,
  };
}

export function isOfflineEntitlementUsable(input: {
  now: number;
  expiresAt: number | null;
  clockSafe: boolean;
}) {
  return input.clockSafe && (
    input.expiresAt === null ||
    (Number.isFinite(input.expiresAt) && input.now < input.expiresAt)
  );
}
