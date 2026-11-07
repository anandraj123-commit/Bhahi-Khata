import type { CurrentSubscription } from './subscription';
/** A verified selection supersedes stale customer rows while the durable queue
 * prevents replacing local bookkeeping data with a server snapshot. */
export function subscriptionCustomerArchived(customer: { id: string; subscriptionArchived?: boolean }, current?: CurrentSubscription) {
  return current?.archivedCustomerIds !== undefined
    ? current.archivedCustomerIds.includes(customer.id)
    : customer.subscriptionArchived === true;
}
/** Never extrapolate paid time beyond the server-provided intervals or grace. */
export function offlineEntitlement(current: CurrentSubscription | undefined, now: number, clockSafe: boolean) {
  if (!current || !clockSafe) return null;
  const verified = Date.parse(current.verifiedAt);
  const grace = current.offlineGraceMilliseconds;
  if (!Number.isFinite(verified) || now < verified || !grace || now - verified > grace) return current.fallbackPlan || null;
  const period = current.timeline?.find(item => Date.parse(item.startsAt) <= now && (!item.expiresAt || now < Date.parse(item.expiresAt)));
  if (period) return period.plan;
  if (!current.timeline && (!current.expiresAt || now < Date.parse(current.expiresAt))) return current.plan;
  return current.fallbackPlan || null;
}
export function canCreateOperationalCustomer(plan: CurrentSubscription['plan'] | null, activeCount: number) {
  return !!plan && Number.isSafeInteger(activeCount) && activeCount >= 0 &&
    (plan.unlimitedCustomers || (plan.customerLimit !== null && activeCount < plan.customerLimit));
}
