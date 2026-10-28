import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { nextVisibleCount, visiblePage } from "../src/pagination.ts";

const app = readFileSync("App.tsx", "utf8");
const customerScreen = app.slice(app.indexOf('case "customer":'), app.indexOf('case "viewCustomer":'));

test("customer history displays ten transactions initially and loads the next ten from cached data", () => {
  for (const length of [0, 1, 9, 10, 11, 25]) {
    const transactions = Array.from({ length }, (_, index) => ({ id: `txn-${index}`, date: `${index}` }));
    let visibleCount = 10;
    const first = visiblePage(transactions, visibleCount);
    assert.equal(first.items.length, Math.min(10, length));
    assert.deepEqual(first.items, transactions.slice(0, 10));
    assert.equal(first.hasMore, length > 10);

    while (first.hasMore && visibleCount < length) {
      const previousCount = visibleCount;
      visibleCount = nextVisibleCount(visibleCount, length, 10);
      assert.equal(visibleCount, Math.min(previousCount + 10, length));
    }
    assert.deepEqual(visiblePage(transactions, visibleCount).items, transactions);
    assert.equal(new Set(visiblePage(transactions, visibleCount).items.map((item) => item.id)).size, length);
  }
});

test("customer history keeps existing newest-first ordering and locally reflects record changes", () => {
  const entries = [
    { id: "new", date: "2026-10-26" },
    { id: "same-date-a", date: "2026-10-25" },
    { id: "same-date-b", date: "2026-10-25" },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `old-${index}`, date: `2026-10-${String(24 - index).padStart(2, "0")}` })),
  ];
  const ordered = entries.slice().sort((a, b) => b.date.localeCompare(a.date));
  assert.deepEqual(ordered.slice(0, 3).map(({ id }) => id), ["new", "same-date-a", "same-date-b"]);
  const edited = ordered.map((entry) => entry.id === "old-0" ? { ...entry, date: "2026-10-27" } : entry)
    .sort((a, b) => b.date.localeCompare(a.date));
  assert.equal(edited[0].id, "old-0");
  const afterDelete = edited.filter((entry) => entry.id !== "old-0");
  assert.equal(afterDelete.some((entry) => entry.id === "old-0"), false);
  assert.match(customerScreen, /data\.entries[\s\S]*?\.filter\(\(e\) => e\.customerId === customer\.id\)[\s\S]*?\.sort\(\(a, b\) => b\.entry\.date\.localeCompare\(a\.entry\.date\) \|\| a\.index - b\.index\)/);
});

test("customer changes reset the visible history and explicit Load More is UI-only", () => {
  assert.match(app, /const \[customerHistoryPage, setCustomerHistoryPage\] = useState\(\{ customerId: "", visibleCount: 10 \}\)/);
  assert.match(app, /if \(route\.screen === "customer" \|\| route\.screen === "viewCustomer"\)\s*setCustomerHistoryPage\(\{ customerId: route\.id \|\| "", visibleCount: 10 \}\);\s*\}, \[route\.screen, route\.id\]\)/);
  assert.match(customerScreen, /const visibleCount = customerHistoryPage\.customerId === customer\.id \? customerHistoryPage\.visibleCount : 10;\s*const visibleEntries = visiblePage\(entries, visibleCount\)/);
  assert.match(customerScreen, /visibleEntries\.hasMore \? <View[\s\S]*?title=\{t\("Load More", data\.language\)\}[\s\S]*?nextVisibleCount\(previous\.customerId === customer\.id \? previous\.visibleCount : 10, entries\.length, 10\)/);
  assert.match(customerScreen, /<CustomerContactInfo customer=\{customer\} compact \/>/);
  assert.doesNotMatch(customerScreen, /pageRecords\(historyItems\)/);
});

test("View Customer renders its own newest-first history with ten-row Load More pagination", () => {
  const viewCustomer = app.slice(app.indexOf('case "viewCustomer":'), app.indexOf('case "credit":', app.indexOf('case "viewCustomer":')));
  assert.match(viewCustomer, /data\.entries[\s\S]*?candidate\.customerId === customer\.id[\s\S]*?\.sort\(\(a, b\) => b\.entry\.date\.localeCompare\(a\.entry\.date\) \|\| a\.index - b\.index\)/);
  assert.match(viewCustomer, /const visibleCount = customerHistoryPage\.customerId === customer\.id \? customerHistoryPage\.visibleCount : 10/);
  assert.match(viewCustomer, /data: visibleEntries\.items[\s\S]*?renderItem: \(item\) => entryRow\(item, true, false, true\)/);
  assert.match(viewCustomer, /<Title>\{t\("Transaction History", data\.language\)\}<\/Title>/);
  assert.match(viewCustomer, /visibleEntries\.hasMore \? <View[\s\S]*?title=\{t\("Load More", data\.language\)\}[\s\S]*?entries\.length, 10\)/);
  assert.match(viewCustomer, /<CustomerAccountStatementActions customerId=\{customer\.id\} loadStatement=\{loadCustomerAccountStatement\} \/>/);
});

test("Load More spans the row with a supported loader icon and yellow styling", () => {
  assert.match(customerScreen, /<Button\s+icon="reload-outline"\s+title=\{t\("Load More", data\.language\)\}/);
  assert.match(app, /loadMoreContainer: \{ alignItems: "stretch", width: "100%"/);
  assert.match(app, /loadMoreButton: \{[^}]*width: "100%"[^}]*backgroundColor: "#FACC15"[^}]*borderColor: "#FACC15"/);
  assert.match(customerScreen, /iconColor="#B45309"\s+textColor="#92400E"/);
  const ionicons = JSON.parse(readFileSync("node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json", "utf8"));
  assert.ok(Object.hasOwn(ionicons, "reload-outline"));
});
