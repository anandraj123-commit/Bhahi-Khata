export const customerOut = (d) => ({
  id: d.clientId,
  serverVersion: d.serverVersion || 1,
  resolutionVersion: d.resolutionVersion || 1,
  createdAt: d.createdAt?.toISOString?.(),
  openingDate:
    d.openingDate?.toISOString?.().slice(0, 10) ||
    d.createdAt?.toISOString?.().slice(0, 10),
  name: d.name,
  phone: d.phoneNormalized || d.phone || "",
  whatsappNumber: d.whatsappNumber || "",
  address: d.address,
  opening: d.openingPaise / 100,
  openingAdvance: (d.openingAdvancePaise || 0) / 100,
  limit: d.limitPaise / 100,
  reminder: d.reminder,
  status: d.status ?? true,
  disabled: d.disabled ?? false,
  removed: d.removed ?? false,
});
export const entryOut = (d) => ({
  id: d.clientId,
  serverVersion: d.serverVersion || 1,
  resolutionVersion: d.resolutionVersion || 1,
  customerId: d.customerClientId,
  type: d.type,
  amount: d.amountPaise / 100,
  date: d.date,
  createdAt: d.createdAt?.toISOString?.(),
  recordedAt: d.recordedAt?.toISOString?.() || d.createdAt?.toISOString?.(),
  note: d.note,
  method: d.method,
  reference: d.reference || "",
  appliedToUdhari: (d.appliedToUdhariPaise || 0) / 100,
  addedToAdvance: (d.addedToAdvancePaise || 0) / 100,
  advanceApplied: (d.advanceAppliedPaise || 0) / 100,
});
export const auditEntryOut = (entry) => {
  if (!entry || typeof entry !== "object") return entry;
  const { due: _legacyDue, ...active } = entry;
  return active;
};
export const financialAuditOut = (record) => ({
  id: `resolution:${record.resolutionId}`,
  action: "Transaction Conflict Resolved",
  date: record.serverAt.toISOString(),
  resolution: {
    customerName: record.customerName || "Customer",
    transactionId: record.transactionId,
    offlineAmount: record.proposed.amount,
    previousServerAmount: record.previousMissing ? 0 : record.previous.amount,
    finalAmount: record.selected?.amount ?? null,
    decision: record.action === "keep_local" ? "Phone Version Selected" : "Server Version Selected",
    resolvedBy: record.actorId ? "Shopkeeper" : "Unknown",
    status: "resolved",
  },
});

export const shopOut = (d) => ({
  serverVersion: d.serverVersion || 1,
  resolutionVersion: d.resolutionVersion || 1,
  name: d.name,
  owner: d.owner,
  address: d.address,
  phone: d.phone,
  whatsapp: d.whatsapp,
  language: d.language,
  defaultMethod: d.defaultMethod,
  reminders: d.reminders,
});

/** Lifecycle snapshots are status metadata, not financial entry snapshots. */
export const auditOut = (item) => {
  const lifecycle = /^CUSTOMER_(DISABLED|ENABLED|REMOVED|RESTORED)$/.test(item.action);
  return {
    id: item.clientId,
    action: item.action,
    date: item.occurredAt.toISOString(),
    ...(lifecycle ? {
      customerLifecycle: {
        customerId: item.after?.customerId,
        previousStatus: item.before?.status,
        newStatus: item.after?.status,
        ...(item.after?.reason ? { reason: item.after.reason } : {}),
      },
    } : {
      ...(item.before ? { before: auditEntryOut(item.before) } : {}),
      ...(item.after ? { after: auditEntryOut(item.after) } : {}),
    }),
  };
};
