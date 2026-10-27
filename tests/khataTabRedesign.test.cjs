const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "App.tsx"), "utf8");
const khataStart = source.indexOf('case "khata": {');
const khataEnd = source.indexOf('case "statement":', khataStart);
const khata = source.slice(khataStart, khataEnd);
const customerStart = source.indexOf('case "customer":');
const customerEnd = source.indexOf('case "viewCustomer":', customerStart);
const customer = source.slice(customerStart, customerEnd);

test("bottom Khata tab opens the screen headed Khata", () => {
  assert.match(source, /screen: "khata", label: "Khata"/);
  assert.match(source, /khata: "Khata"/);
  assert.match(source, /onPress=\{\(\) => go\(t\.screen, undefined, true\)\}/);
  assert.ok(khata.length > 0);
});

test("Khata ledger cards retain customer contacts, balances, and history without transaction action tabs", () => {
  assert.match(khata, /t\("Personal Information", data\.language\)/);
  assert.match(khata, /<CustomerContactInfo customer=\{c\} compact \/>/);
  assert.match(khata, /t\("Account Balance", data\.language\)/);
  assert.match(khata, /khataBalanceDisplay\(m\.opening\)/);
  assert.match(khata, /khataBalanceDisplay\(m\.closing\)/);
  assert.match(khata, /Opening Advance Adjusted Against Udhari/);
  assert.doesNotMatch(khata, /t\("Transactions", data\.language\)/);
  assert.doesNotMatch(khata, /go\("credit", c\.id\)/);
  assert.doesNotMatch(khata, /go\("refund", c\.id\)/);
  assert.doesNotMatch(khata, /go\("payment", c\.id\)/);
  assert.match(khata, /t\("Transaction History", data\.language\)/);
  assert.match(khata, /<MonthlyKhataStatementActions[\s\S]*customerId=\{c\.id\}[\s\S]*month=\{month\}[\s\S]*transactionFilter=\{filter\}[\s\S]*customerSearch=\{search\}[\s\S]*customerCreatedDateFilter=\{khataCustomerDateFilter\}/);
  assert.match(khata, /loadStatement=\{loadMonthlyKhataStatement\}/);
  assert.match(khata, /data: khataRows/);
  assert.match(khata, /const visibleEntries = entries\.slice\(-limit\)/);
  assert.equal((khata.match(/<Card style=\{khataStyles\.customerCard\}>/g) || []).length, 1);
  assert.doesNotMatch(khata, /<Card style=\{khataStyles\.(?:infoCard|balanceCard|historyCard)/);
});

test("each Khata customer card has a highlighted, wrapping name header with the existing contact actions", () => {
  assert.match(source, /customerHeader: \{[^}]*backgroundColor: "#F0FDF4"/);
  assert.match(source, /customerHeaderTitle: \{[^}]*textTransform: "uppercase"/);
  assert.match(source, /customerNameText: \{[^}]*fontSize: 19[^}]*fontWeight: "700"/);
  assert.match(khata, /<View style=\{khataStyles\.customerHeader\}>[\s\S]*<CustomerContactInfo customer=\{c\} compact \/>/);
  assert.match(khata, /<Text style=\{khataStyles\.customerNameText\}>\{c\.name\}<\/Text>/);
  assert.doesNotMatch(khata, /customerNameText\}\s+numberOfLines=/);
  assert.match(khata, /customerLifecycleState\(c\)/);
});

test("Khata history starts with newest 10 and expands by 10 without dropping visible rows", () => {
  assert.match(khata, /const limit = khataCustomerTransactionLimits\[limitKey\] \|\| 10/);
  assert.match(khata, /const visibleEntries = entries\.slice\(-limit\)/);
  assert.match(khata, /Math\.min\(\(previous\[limitKey\] \|\| 10\) \+ 10, entries\.length\)/);
  assert.match(source, /loadMoreContainer: \{ width: "100%", alignItems: "stretch"/);
  assert.match(source, /loadMoreButton: \{ width: "100%", alignSelf: "stretch", minHeight: 48, backgroundColor: "#FACC15"/);
  assert.match(khata, /receiptAccountIdentity\(data\.shop\.phone \|\| ""\)/);
});

test("Khata search and transaction filter tabs have vertical separation", () => {
  assert.match(khata, /<Chips[\s\S]*items=\{\["All", "Udhari", "Payment"\]\}[\s\S]*style=\{\{ marginTop: 14 \}\}/);
});

test("Customer Details retains its separate contact, lifecycle, financial, history, and PDF actions", () => {
  assert.match(customer, /<CustomerContactInfo customer=\{customer\} compact \/>/);
  assert.match(customer, /customerLifecycleState\(customer\)/);
  assert.match(customer, /Current Outstanding/);
  assert.match(customer, /Advance Deposited/);
  assert.match(customer, /<CustomerAccountStatementActions customerId=\{customer\.id\}/);
  assert.match(customer, /nextVisibleCount\([^\n]*10\)/);
  assert.match(customer, /actions\(customer\.id, true\)/);
});
