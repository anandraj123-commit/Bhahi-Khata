import type { Entry } from "./model";

export type ClockTime = { hour: number; minute: number; period: "AM" | "PM" };

export function formatClockTime(value: Date) {
  return value
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\b(am|pm)\b/i, (period) => period.toUpperCase());
}

export function parseClockTime(value: string): ClockTime | null {
  const match = value.trim().match(/^(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)$/i);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]), period: match[3].toUpperCase() as "AM" | "PM" };
}

export function localDateTimeIso(dateValue: string, timeValue: string): string | null {
  const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time = parseClockTime(timeValue);
  if (!match || !time) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return null;
  const hour24 = (time.hour % 12) + (time.period === "PM" ? 12 : 0);
  return new Date(year, month - 1, day, hour24, time.minute, 0, 0).toISOString();
}

/** Displays the accounting date together with the actual entry time when known.
 * Legacy records without a timestamp remain date-only rather than inventing midnight. */
export function entryDateTime(entry: Pick<Entry, "date" | "recordedAt" | "createdAt">, locale: string) {
  const accountingDate = new Date(`${entry.date}T12:00:00`);
  const dateText = Number.isNaN(accountingDate.getTime())
    ? entry.date
    : accountingDate.toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
  const timestamp = entry.recordedAt || entry.createdAt;
  if (!timestamp) return dateText;
  const recorded = new Date(timestamp);
  if (Number.isNaN(recorded.getTime())) return dateText;
  const timeText = recorded
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\b(am|pm)\b/i, (period) => period.toUpperCase());
  return `${dateText}, ${timeText}`;
}
