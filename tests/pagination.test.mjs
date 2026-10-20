import assert from "node:assert/strict";
import test from "node:test";
import { PAGE_SIZE, UserScrollPageGate, nextVisibleCount, visiblePage } from "../src/pagination.ts";

test("pagination defaults to fifteen records and handles empty and short lists", () => {
  assert.equal(PAGE_SIZE, 15);
  assert.deepEqual(visiblePage([], PAGE_SIZE), { items: [], hasMore: false });
  assert.deepEqual(visiblePage(["a"], PAGE_SIZE), { items: ["a"], hasMore: false });
  const exact = Array.from({ length: PAGE_SIZE }, (_, index) => index);
  assert.deepEqual(visiblePage(exact, PAGE_SIZE), { items: exact, hasMore: false });
});

test("incremental pages reach every record without duplication or omission", () => {
  for (const length of [16, 30, 31, 500, 2000]) {
    const records = Array.from({ length }, (_, index) => `record-${index}`);
    const accumulated = [];
    for (let count = PAGE_SIZE; count < length + PAGE_SIZE; count += PAGE_SIZE) {
      accumulated.push(...visiblePage(records, count).items.slice(accumulated.length));
    }
    assert.deepEqual(accumulated, records);
    assert.equal(new Set(accumulated).size, length);
  }
});

test("visible pages preserve source ordering and report whether another page exists", () => {
  const records = Array.from({ length: 31 }, (_, index) => index);
  assert.deepEqual(visiblePage(records, 15), { items: records.slice(0, 15), hasMore: true });
  assert.deepEqual(visiblePage(records, 30), { items: records.slice(0, 30), hasMore: true });
  assert.deepEqual(visiblePage(records, 45), { items: records, hasMore: false });
});

test("customer lists start with at most fifteen rows at every supported size", () => {
  for (const length of [0, 1, 14, 15, 16, 30, 31, 100, 500]) {
    const records = Array.from({ length }, (_, index) => index);
    const initial = visiblePage(records, PAGE_SIZE);
    assert.equal(initial.items.length, Math.min(PAGE_SIZE, length), `length=${length}`);
    assert.deepEqual(initial.items, records.slice(0, PAGE_SIZE));
  }
});

test("a page advances once per genuine user drag, not on mount or repeated end events", () => {
  const gate = new UserScrollPageGate();
  assert.equal(gate.claimPage(), false, "mount/layout onEndReached must not page");
  gate.beginUserScroll();
  assert.equal(gate.claimPage(), false, "a touch without actual scrolling must not page");
  gate.markUserMovement();
  assert.equal(gate.claimPage(), true);
  assert.equal(gate.claimPage(), false, "repeated callbacks for one drag are ignored");
  gate.beginUserScroll();
  gate.markUserMovement();
  assert.equal(gate.claimPage(), true, "a subsequent genuine drag may load another page");
});

test("a 100-customer list stays at 15 until successive genuine scrolls", () => {
  const gate = new UserScrollPageGate();
  const total = 100;
  let count = PAGE_SIZE;
  assert.equal(gate.claimPage(), false);
  assert.equal(count, 15);
  gate.beginUserScroll();
  gate.markUserMovement();
  if (gate.claimPage()) count = nextVisibleCount(count, total);
  assert.equal(count, 30);
  assert.equal(gate.claimPage(), false);
  assert.equal(count, 30);
  gate.beginUserScroll();
  gate.markUserMovement();
  if (gate.claimPage()) count = nextVisibleCount(count, total);
  assert.equal(count, 45);
});

test("customer pages append fifteen filtered rows without duplicates or skipped rows", () => {
  for (const length of [0, 1, 14, 15, 16, 30, 31, 100, 500]) {
    const all = Array.from({ length }, (_, index) => ({ id: index, paid: index % 2 === 0 }));
    for (const matching of [all, all.filter((record) => record.paid), all.filter((record) => !record.paid)]) {
      const shown = [];
      let count = Math.min(PAGE_SIZE, matching.length);
      shown.push(...visiblePage(matching, count).items);
      while (count < matching.length) {
        count = nextVisibleCount(count, matching.length);
        shown.push(...visiblePage(matching, count).items.slice(shown.length));
      }
      assert.deepEqual(shown, matching);
      assert.equal(new Set(shown.map((record) => record.id)).size, matching.length);
    }
  }
});
