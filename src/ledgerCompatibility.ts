/** Remove the retired field from records persisted by older app versions. */
export function withoutLegacyDue<T extends object>(value: T): Omit<T, "due"> {
  const active = { ...value } as T & { due?: unknown };
  delete active.due;
  return active;
}

export function withoutLegacyDueFromAudit<T extends {
  before?: object;
  after?: object;
}>(value: T): T {
  const { before, after, ...rest } = value;
  // Older API/cache versions stored lifecycle metadata in Entry-shaped fields.
  // Convert only valid lifecycle snapshots; malformed records remain invalid.
  const audit = value as T & { action?: string };
  const previous = before as { customerId?: unknown; status?: unknown } | undefined;
  const next = after as { customerId?: unknown; status?: unknown; reason?: unknown } | undefined;
  const states = ["active", "disabled", "removed"];
  if (/^CUSTOMER_(DISABLED|ENABLED|REMOVED|RESTORED)$/.test(audit.action || "") &&
      typeof next?.customerId === "string" && previous?.customerId === next.customerId &&
      states.includes(String(previous?.status)) && states.includes(String(next.status)) &&
      (next.reason === undefined || typeof next.reason === "string")) {
    return {
      ...rest,
      customerLifecycle: {
        customerId: next.customerId,
        previousStatus: previous!.status,
        newStatus: next.status,
        ...(next.reason !== undefined ? { reason: next.reason } : {}),
      },
    } as unknown as T;
  }
  return {
    ...rest,
    ...(before ? { before: withoutLegacyDue(before) } : {}),
    ...(after ? { after: withoutLegacyDue(after) } : {}),
  } as T;
}
