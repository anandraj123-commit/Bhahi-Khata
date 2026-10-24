/** Select the event timestamp for a ledger entry. Offline queue replay keeps
 * its original device-recorded timestamp; online writes use server time. */
export function ledgerRecordedAt(entryRecordedAt, useServerRecordedAt, serverNow = () => new Date()) {
  if (useServerRecordedAt) return serverNow();
  return entryRecordedAt ? new Date(entryRecordedAt) : serverNow();
}
