import assert from "node:assert/strict";
import test from "node:test";
import { entryDateTime, formatClockTime, localDateTimeIso, parseClockTime } from "./entryPresentation.ts";

test("formats an entry accounting date with its recorded time and AM/PM", () => {
  const value = entryDateTime({
    date: "2026-10-25",
    recordedAt: "2026-10-25T09:07:00.000Z",
  }, "en-IN");
  const expectedTime = new Date("2026-10-25T09:07:00.000Z")
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\b(am|pm)\b/i, (period) => period.toUpperCase());
  assert.match(value, /25 Oct 2026/);
  assert.equal(value, `25 Oct 2026, ${expectedTime}`);
});

test("prefers recorded time over server synchronization creation time", () => {
  const value = entryDateTime({
    date: "2026-10-20",
    recordedAt: "2026-10-20T08:00:00.000Z",
    createdAt: "2026-10-25T09:07:00.000Z",
  }, "en-IN");
  const expectedTime = new Date("2026-10-20T08:00:00.000Z")
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\b(am|pm)\b/i, (period) => period.toUpperCase());
  assert.equal(value, `20 Oct 2026, ${expectedTime}`);
});

test("keeps legacy entries date-only when no trustworthy time exists", () => {
  assert.equal(entryDateTime({ date: "2026-10-25" }, "en-IN"), "25 Oct 2026");
});

test("parses AM/PM times and combines chosen local date and time", () => {
  assert.deepEqual(parseClockTime("12:05 am"), { hour: 12, minute: 5, period: "AM" });
  assert.deepEqual(parseClockTime("12:05 PM"), { hour: 12, minute: 5, period: "PM" });
  assert.equal(parseClockTime("13:90 PM"), null);
  const value = localDateTimeIso("2026-10-25", "12:05 AM");
  assert.ok(value);
  const local = new Date(value);
  assert.equal(local.getFullYear(), 2026);
  assert.equal(local.getMonth(), 9);
  assert.equal(local.getDate(), 25);
  assert.equal(local.getHours(), 0);
  assert.equal(local.getMinutes(), 5);
  assert.equal(formatClockTime(new Date(2026, 9, 25, 12, 5)), "12:05 PM");
});

test("rejects invalid dates and times", () => {
  assert.equal(localDateTimeIso("2026-02-30", "3:45 PM"), null);
  assert.equal(localDateTimeIso("2026-10-25", "24:00"), null);
});
