import assert from "node:assert/strict";
import test from "node:test";
import { deviceClockNeedsWarning, estimateServerClockOffset } from "./serverClock.ts";

test("estimates offset against the midpoint of an API request", () => {
  const offset = estimateServerClockOffset(
    "Sun, 25 Oct 2026 10:00:00 GMT",
    Date.parse("2026-10-25T09:54:00.000Z"),
    Date.parse("2026-10-25T09:54:02.000Z"),
  );
  assert.equal(offset, 5 * 60 * 1000 + 59 * 1000);
  assert.equal(deviceClockNeedsWarning(offset), true);
});

test("does not warn for small skew or an unusable server time", () => {
  const smallOffset = estimateServerClockOffset(
    "Sun, 25 Oct 2026 10:00:00 GMT",
    Date.parse("2026-10-25T09:59:00.000Z"),
    Date.parse("2026-10-25T10:00:00.000Z"),
  );
  assert.equal(deviceClockNeedsWarning(smallOffset), false);
  assert.equal(estimateServerClockOffset(null, 1, 2), null);
  assert.equal(estimateServerClockOffset("not a date", 1, 2), null);
  assert.equal(estimateServerClockOffset("Sun, 25 Oct 2026 10:00:00 GMT", 2, 1), null);
  assert.equal(deviceClockNeedsWarning(null), false);
});
