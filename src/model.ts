export type Customer = {
  id: string;
  name: string;
  phone: string;
  address: string;
  opening: number;
  limit: number;
  reminder: boolean;
};
export type Entry = {
  id: string;
  customerId: string;
  type: "credit" | "payment";
  amount: number;
  date: string;
  note: string;
  method: string;
  due: string;
};
export type Shop = {
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
};
export type Data = {
  shop: Shop;
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
export const uid = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
export const money = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const initialData: Data = {
  shop: { name: "", owner: "", address: "", phone: "", whatsapp: "" },
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
  paise(entry.amount) * (entry.type === "credit" ? 1 : -1);
export const balance = (data: Data, id: string) =>
  (paise(data.customers.find((c) => c.id === id)?.opening || 0) +
    data.entries
      .filter((e) => e.customerId === id)
      .reduce((sum, entry) => sum + signedPaise(entry), 0)) /
  100;
export function monthly(data: Data, id: string, month: string) {
  const customer = data.customers.find((c) => c.id === id);
  const entries = data.entries
    .filter((e) => e.customerId === id && e.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date));
  const openingPaise =
    paise(customer?.opening || 0) +
    data.entries
      .filter((e) => e.customerId === id && e.date.slice(0, 7) < month)
      .reduce((sum, entry) => sum + signedPaise(entry), 0);
  const creditPaise = entries
    .filter((e) => e.type === "credit")
    .reduce((sum, entry) => sum + paise(entry.amount), 0);
  const paymentPaise = entries
    .filter((e) => e.type === "payment")
    .reduce((sum, entry) => sum + paise(entry.amount), 0);
  return {
    entries,
    opening: openingPaise / 100,
    credit: creditPaise / 100,
    payment: paymentPaise / 100,
    closing: (openingPaise + creditPaise - paymentPaise) / 100,
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
    ["name", "owner", "address", "phone", "whatsapp"].every(
      (k) => typeof (d.shop as any)[k] === "string",
    ) &&
    Array.isArray(d.customers) &&
    d.customers.every(
      (c) =>
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.phone === "string" &&
        typeof c.address === "string" &&
        Number.isFinite(c.opening) &&
        c.opening >= 0 &&
        c.opening <= 1e9 &&
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
        ["credit", "payment"].includes(e.type) &&
        Number.isFinite(e.amount) &&
        e.amount >= 0.01 &&
        e.amount <= 1e9 &&
        isDate(e.date) &&
        typeof e.note === "string" &&
        typeof e.method === "string" &&
        typeof e.due === "string" &&
        (!e.due || isDate(e.due)),
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
            typeof a.after.note === "string")),
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
