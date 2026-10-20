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
  return {
    ...rest,
    ...(before ? { before: withoutLegacyDue(before) } : {}),
    ...(after ? { after: withoutLegacyDue(after) } : {}),
  } as T;
}
