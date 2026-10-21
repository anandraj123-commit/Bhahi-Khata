import * as Crypto from "expo-crypto";

export type Customer = {
  id: string;
  /** Mutually exclusive lifecycle flags; old cached records normalize to Active. */
  status: boolean;
  disabled: boolean;
  removed: boolean;
  /** Authoritative server revision; absent for local-only records. */
  serverVersion?: number;
  resolutionVersion?: number;
  createdAt?: string;
  /** Calendar date the opening outstanding was first recorded. */
  openingDate?: string;
  name: string;
  phone: string;
  address: string;
  opening: number;
  openingAdvance?: number;
  limit: number;
  reminder: boolean;
};
export type Entry = {
  id: string;
  /** Authoritative server revision. Omitted for entries created offline. */
  serverVersion?: number;
  resolutionVersion?: number;
  customerId: string;
  type: "credit" | "payment" | "refund";
  amount: number;
  date: string;
  recordedAt?: string;
  note: string;
  method: string;
  reference?: string;
  /** Server-reconciled receipt allocation, in rupees. */
  appliedToUdhari?: number;
  addedToAdvance?: number;
  advanceApplied?: number;
};
export type Shop = {
  serverVersion?: number;
  resolutionVersion?: number;
  name: string;
  owner: string;
  address: string;
  phone: string;
  whatsapp: string;
};
export type Audit = {
  id: string;
  action: string;
  date: string;
  before?: Entry;
  after?: Entry;
  customerLifecycle?: {
    customerId: string;
    previousStatus: "active" | "disabled" | "removed";
    newStatus: "active" | "disabled" | "removed";
    reason?: string;
  };
  resolution?: {
    customerName: string;
    transactionId: string;
    offlineAmount: number;
    previousServerAmount: number;
    finalAmount: number | null;
    decision: "Phone Version Selected" | "Server Version Selected";
    resolvedBy: string;
    status: "resolved";
  };
};
export type Data = {
  shop: Shop;
  /** True only when the authenticated account owns a persisted Shop document. */
  shopExists?: boolean;
  /** True when required display fields are present; legacy blank profiles remain editable. */
  shopComplete?: boolean;
  customers: Customer[];
  entries: Entry[];
  audit: Audit[];
  signedIn: boolean;
  language: string;
  reminders: {
    enabled: boolean;
    day: string;
    time: string;
    minimum: string;
    whatsapp: boolean;
    sms: boolean;
  };
  defaultMethod: string;
  read: string[];
};
export const today = () => new Date().toLocaleDateString("en-CA");
export const uid = () => Crypto.randomUUID();
export const money = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const initialData: Data = {
  shop: { name: "", owner: "", address: "", phone: "", whatsapp: "" },
  shopExists: false,
  shopComplete: false,
  customers: [],
  entries: [],
  audit: [],
  signedIn: false,
  language: "English",
  reminders: {
    enabled: true,
    day: "Last day",
    time: "10:00",
    minimum: "100",
    whatsapp: true,
    sms: false,
  },
  defaultMethod: "Cash",
  read: [],
};
// Sum integer paise to avoid binary floating-point drift in ledger totals.
const paise = (value: number) => Math.round(value * 100);
const signedPaise = (entry: Entry) =>
  paise(entry.amount) * (entry.type === "credit" || entry.type === "refund" ? 1 : -1);
const openingDate = (customer: Customer) =>
  customer.openingDate || customer.createdAt?.slice(0, 10);

/** Cumulative Udhari is opening outstanding plus all later credit entries. */
export function totalUdhari(data: Data, id?: string) {
  const customers = data.customers.filter((customer) => !id || customer.id === id);
  const customerIds = new Set(customers.map((customer) => customer.id));
  const opening = customers.reduce((sum, customer) => sum + paise(customer.opening), 0);
  const credits = data.entries
    .filter((entry) => customerIds.has(entry.customerId) && entry.type === "credit")
    .reduce((sum, entry) => sum + paise(entry.amount), 0);
  return (opening + credits) / 100;
}

/** Cumulative repayments; these reduce outstanding, not cumulative Udhari. */
export function totalReceived(data: Data, id?: string) {
  const customers = data.customers.filter((customer) => !id || customer.id === id);
  const customerIds = new Set(customers.map((customer) => customer.id));
  const openingAdvance = customers.reduce(
    (sum, customer) => sum + paise(customer.openingAdvance || 0),
    0,
  );
  return (openingAdvance + data.entries
    .filter((entry) => customerIds.has(entry.customerId) && entry.type === "payment")
    .reduce((sum, entry) => sum + paise(entry.amount), 0)) / 100;
}

/** Udhari recorded during a period, including openings recorded in that period. */
export function periodUdhari(data: Data, month: string, id?: string) {
  const customerIds = new Set(
    data.customers
      .filter((customer) => !id || customer.id === id)
      .map((customer) => customer.id),
  );
  const credits = data.entries
    .filter(
      (entry) =>
        customerIds.has(entry.customerId) &&
        entry.type === "credit" &&
        entry.date.startsWith(month),
    )
    .reduce((sum, entry) => sum + paise(entry.amount), 0);
  const opening = data.customers
    .filter(
      (customer) =>
        customerIds.has(customer.id) && openingDate(customer)?.slice(0, 7) === month,
    )
    .reduce((sum, customer) => sum + paise(customer.opening), 0);
  return (credits + opening) / 100;
}

export function periodReceived(data: Data, month: string, id?: string) {
  const customers = data.customers.filter((customer) => !id || customer.id === id);
  const customerIds = new Set(customers.map((customer) => customer.id));
  const openingAdvance = customers
    .filter((customer) => openingDate(customer)?.slice(0, 7) === month)
    .reduce((sum, customer) => sum + paise(customer.openingAdvance || 0), 0);
  return (openingAdvance + data.entries
    .filter(
      (entry) =>
        customerIds.has(entry.customerId) &&
        entry.type === "payment" &&
        entry.date.startsWith(month),
    )
    .reduce((sum, entry) => sum + paise(entry.amount), 0)) / 100;
}

function customerFinancialSummary(data: Data, customer: Customer) {
  const entries = data.entries
    .filter((entry) => entry.customerId === customer.id)
    .slice()
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      (a.recordedAt || `${a.date}T00:00:00.000Z`).localeCompare(
        b.recordedAt || `${b.date}T00:00:00.000Z`,
      ) ||
      a.id.localeCompare(b.id),
    );
  const openingRecordedOn = openingDate(customer);
  const events = [
    ...(openingRecordedOn
      ? [{ kind: "opening" as const, date: openingRecordedOn, recordedAt: `${openingRecordedOn}T00:00:00.000Z` }]
      : []),
    ...entries.map((entry) => ({ kind: "entry" as const, date: entry.date, recordedAt: entry.recordedAt || `${entry.date}T00:00:00.000Z`, entry })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt) || (a.kind === "opening" ? -1 : 1));
  const openingUdhariPaise = paise(customer.opening);
  const openingAdvancePaise = paise(customer.openingAdvance || 0);
  const openingRecoveredPaise = Math.min(openingUdhariPaise, openingAdvancePaise);
  let netPaise = openingRecordedOn
    ? 0
    : openingUdhariPaise - openingAdvancePaise;
  let recoveredPaise = openingRecordedOn ? 0 : openingRecoveredPaise;
  let depositedAdvancePaise = openingRecordedOn ? 0 : openingAdvancePaise;
  let receivedPaise = openingRecordedOn ? 0 : openingAdvancePaise;
  let refundedPaise = 0;
  let advanceAppliedPaise = 0;
  for (const event of events) {
    if (event.kind === "opening") {
      netPaise = openingUdhariPaise - openingAdvancePaise;
      recoveredPaise += openingRecoveredPaise;
      depositedAdvancePaise += openingAdvancePaise;
      receivedPaise += openingAdvancePaise;
      continue;
    }
    const entry = event.entry;
    const amount = paise(entry.amount);
    if (entry.type === "credit") {
      advanceAppliedPaise += Math.min(Math.max(0, -netPaise), amount);
      netPaise += amount;
    }
    else if (entry.type === "payment") {
      const applied = Math.min(Math.max(0, netPaise), amount);
      recoveredPaise += applied;
      depositedAdvancePaise += amount - applied;
      receivedPaise += amount;
      netPaise -= amount;
    } else {
      refundedPaise += amount;
      netPaise += amount;
    }
  }
  return {
    netPaise,
    outstandingPaise: Math.max(0, netPaise),
    availableAdvancePaise: Math.max(0, -netPaise),
    udhariPaise:
      paise(customer.opening) +
      entries
        .filter((entry) => entry.type === "credit")
        .reduce((sum, entry) => sum + paise(entry.amount), 0),
    receivedPaise,
    recoveredPaise,
    depositedAdvancePaise,
    refundedPaise,
    advanceAppliedPaise,
  };
}

export function financialSummary(data: Data, id?: string) {
  return data.customers
    .filter((customer) => !id || customer.id === id)
    .reduce(
      (sum, customer) => {
        const item = customerFinancialSummary(data, customer);
        sum.outstandingPaise += item.outstandingPaise;
        sum.availableAdvancePaise += item.availableAdvancePaise;
        sum.totalUdhariPaise += item.udhariPaise;
        sum.totalReceivedPaise += item.receivedPaise;
        sum.totalUdhariRecoveredPaise += item.recoveredPaise;
        sum.totalAdvanceDepositedPaise += item.depositedAdvancePaise;
        sum.totalAdvanceRefundedPaise += item.refundedPaise;
        return sum;
      },
      {
        outstandingPaise: 0,
        availableAdvancePaise: 0,
        totalUdhariPaise: 0,
        totalReceivedPaise: 0,
        totalUdhariRecoveredPaise: 0,
        totalAdvanceDepositedPaise: 0,
        totalAdvanceRefundedPaise: 0,
      },
    );
}

export const balance = (data: Data, id: string) =>
  ((paise(data.customers.find((c) => c.id === id)?.opening || 0) -
    paise(data.customers.find((c) => c.id === id)?.openingAdvance || 0)) +
    data.entries
      .filter((e) => e.customerId === id)
      .reduce((sum, entry) => sum + signedPaise(entry), 0)) /
  100;
export function monthly(data: Data, id: string, month: string) {
  const customer = data.customers.find((c) => c.id === id);
  const entries = data.entries
    .filter((e) => e.customerId === id && e.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date));
  const recordedOpeningMonth = customer ? openingDate(customer)?.slice(0, 7) : undefined;
  const openingPaise =
    (recordedOpeningMonth === undefined || recordedOpeningMonth < month
      ? paise(customer?.opening || 0) - paise(customer?.openingAdvance || 0)
      : 0) +
    data.entries
      .filter((e) => e.customerId === id && e.date.slice(0, 7) < month)
      .reduce((sum, entry) => sum + signedPaise(entry), 0);
  const creditPaise = entries
    .filter((e) => e.type === "credit")
    .reduce((sum, entry) => sum + paise(entry.amount), 0) +
    (recordedOpeningMonth === month ? paise(customer?.opening || 0) : 0);
  const paymentPaise = entries
    .filter((e) => e.type === "payment")
    .reduce((sum, entry) => sum + paise(entry.amount), 0) +
    (recordedOpeningMonth === month ? paise(customer?.openingAdvance || 0) : 0);
  const refundPaise = entries
    .filter((e) => e.type === "refund")
    .reduce((sum, entry) => sum + paise(entry.amount), 0);
  return {
    entries,
    opening: openingPaise / 100,
    credit: creditPaise / 100,
    payment: paymentPaise / 100,
    refund: refundPaise / 100,
    closing: (openingPaise + creditPaise - paymentPaise + refundPaise) / 100,
  };
}
function isDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function validBackup(value: unknown): value is Data {
  if (!value || typeof value !== "object") return false;
  const d = value as Data;
  return (
    !!d.shop &&
    (d.shopExists === undefined || typeof d.shopExists === "boolean") &&
    (d.shopComplete === undefined || typeof d.shopComplete === "boolean") &&
    ["name", "owner", "address", "phone", "whatsapp"].every(
      (k) => typeof (d.shop as any)[k] === "string",
    ) &&
    Array.isArray(d.customers) &&
    d.customers.every(
      (c) =>
        typeof c.id === "string" &&
        (c.createdAt === undefined || typeof c.createdAt === "string") &&
        typeof c.name === "string" &&
        typeof c.phone === "string" &&
        typeof c.address === "string" &&
        Number.isFinite(c.opening) &&
        c.opening >= 0 &&
        c.opening <= 1e9 &&
        (c.openingAdvance === undefined ||
          (Number.isFinite(c.openingAdvance) &&
            c.openingAdvance >= 0 &&
            c.openingAdvance <= 1e9)) &&
        Number.isFinite(c.limit) &&
        c.limit >= 0 &&
        c.limit <= 1e9 &&
        typeof c.reminder === "boolean",
    ) &&
    new Set(d.customers.map((c) => c.id)).size === d.customers.length &&
    Array.isArray(d.entries) &&
    d.entries.every(
      (e) =>
        typeof e.id === "string" &&
        d.customers.some((c) => c.id === e.customerId) &&
        ["credit", "payment", "refund"].includes(e.type) &&
        Number.isFinite(e.amount) &&
        e.amount >= 0.01 &&
        e.amount <= 1e9 &&
        isDate(e.date) &&
        typeof e.note === "string" &&
        typeof e.method === "string",
    ) &&
    new Set(d.entries.map((e) => e.id)).size === d.entries.length &&
    Array.isArray(d.audit) &&
    d.audit.every(
      (a) =>
        typeof a.id === "string" &&
        typeof a.action === "string" &&
        typeof a.date === "string" &&
        (!a.before ||
          (Number.isFinite(a.before.amount) &&
            typeof a.before.date === "string" &&
            typeof a.before.note === "string")) &&
        (!a.after ||
          (Number.isFinite(a.after.amount) &&
            typeof a.after.date === "string" &&
            typeof a.after.note === "string")) &&
        (!a.customerLifecycle ||
          (typeof a.customerLifecycle.customerId === "string" &&
            ["active", "disabled", "removed"].includes(a.customerLifecycle.previousStatus) &&
            ["active", "disabled", "removed"].includes(a.customerLifecycle.newStatus) &&
            (a.customerLifecycle.reason === undefined || typeof a.customerLifecycle.reason === "string"))) &&
        (!a.resolution ||
          (typeof a.resolution.customerName === "string" &&
            typeof a.resolution.transactionId === "string" &&
            Number.isFinite(a.resolution.offlineAmount) &&
            Number.isFinite(a.resolution.previousServerAmount) &&
            (a.resolution.finalAmount === null || Number.isFinite(a.resolution.finalAmount)) &&
            ["Phone Version Selected", "Server Version Selected"].includes(a.resolution.decision) &&
            typeof a.resolution.resolvedBy === "string" &&
            a.resolution.status === "resolved")),
    ) &&
    !!d.reminders &&
    typeof d.reminders.enabled === "boolean" &&
    typeof d.reminders.day === "string" &&
    typeof d.reminders.time === "string" &&
    typeof d.reminders.minimum === "string" &&
    typeof d.reminders.whatsapp === "boolean" &&
    typeof d.reminders.sms === "boolean" &&
    Array.isArray(d.read) &&
    d.read.every((x) => typeof x === "string") &&
    typeof d.language === "string" &&
    typeof d.defaultMethod === "string" &&
    typeof d.signedIn === "boolean"
  );
}
