const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");
const React = require("react");

const appSource = fs.readFileSync(path.join(__dirname, "..", "App.tsx"), "utf8");
const uiSource = fs.readFileSync(path.join(__dirname, "ui.tsx"), "utf8");
const ionicons = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "node_modules",
      "@expo",
      "vector-icons",
      "build",
      "vendor",
      "react-native-vector-icons",
      "glyphmaps",
      "Ionicons.json",
    ),
    "utf8",
  ),
);

const customerScreen = appSource.slice(
  appSource.indexOf('case "customer":'),
  appSource.indexOf('case "viewCustomer":'),
);
const homeScreen = appSource.slice(
  appSource.indexOf('case "home":'),
  appSource.indexOf('case "customers":'),
);
const iconStart = uiSource.indexOf("export const Icon = (");
const iconEnd = uiSource.indexOf("export function Button", iconStart);
assert.ok(iconStart >= 0 && iconEnd > iconStart, "Shared Icon component source must exist");
const iconModule = { exports: {} };
const MockIonicons = function MockIonicons() {};
const compiledIcon = ts.transpileModule(uiSource.slice(iconStart, iconEnd), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInNewContext(compiledIcon, {
  exports: iconModule.exports,
  React,
  Ionicons: MockIonicons,
  colors: { green: "#15803D" },
});

const financialIconCases = [
  ["Total Udhari", "arrow-up-circle-outline"],
  ["Total Money Received", "arrow-down-circle-outline"],
  ["Udhari Recovered", "checkmark-circle-outline"],
  ["Advance Deposited", "cash-outline"],
  ["Advance Refunded", "return-down-back-outline"],
  ["Available Advance", "wallet-outline"],
];

test("Current Outstanding renders a visible wallet icon beside its label", () => {
  assert.match(
    customerScreen,
    /<Icon name="wallet-outline" size=\{18\} style=\{customerDetailsStyles\.summaryIcon\} color=\{financialPalette\[[^\]]+\]\.text\} \/>/,
  );
  assert.match(customerScreen, /<Hint style=\{\{ color: [^}]+ \}\}>Current Outstanding<\/Hint>/);
});

for (const [label, icon] of financialIconCases) {
  test(`${label} card passes ${icon} to the rendered Icon component`, () => {
    const statCallPattern = new RegExp(
      `stat\\(\\s*"${label}"[\\s\\S]{0,400}?"${icon}"\\s*,?\\s*\\)`,
    );
    assert.match(customerScreen, statCallPattern);
    assert.ok(Object.hasOwn(ionicons, icon), `${icon} is absent from installed Ionicons glyph map`);
  });
}

test("summary-card icon renderer forwards visible size and contrast color", () => {
  assert.match(
    appSource,
    /<Icon name=\{icon\} color=\{palette\.text\} size=\{18\} style=\{customerDetailsStyles\.summaryIcon\} \/>/,
  );
  assert.match(appSource, /summaryIcon: \{ width: 18, height: 18, flexShrink: 0 \}/);
  assert.match(appSource, /statLabelRow: \{ flexDirection: "row", alignItems: "center", gap: 8 \}/);
  assert.match(appSource, /<Text style=\{\[s\.stat, \{ color: palette\.text \}, compact && customerDetailsStyles\.statValue\]\}>\{value\}<\/Text>/);
});

test("Transaction History heading renders its time icon", () => {
  assert.match(customerScreen, /<Icon name="time-outline" size=\{18\} style=\{customerDetailsStyles\.summaryIcon\} color=\{colors\.dark\} \/>/);
  assert.ok(Object.hasOwn(ionicons, "time-outline"));
});

test("shared Icon forwards its name, size and color to Ionicons", () => {
  assert.match(uiSource, /<Ionicons accessible=\{false\} name=\{name\} size=\{size\} color=\{color\} style=\{\[\{ flexShrink: 0 \}, style\]\} \/>/);
});

test("shared Icon renders an Ionicons element with a visible 18 dp presentation", () => {
  const style = { width: 18, height: 18, flexShrink: 0 };
  const iconElement = iconModule.exports.Icon({
    name: "wallet-outline",
    size: 18,
    color: "#475569",
    style,
  });
  assert.equal(iconElement.type, MockIonicons);
  assert.equal(iconElement.props.name, "wallet-outline");
  assert.equal(iconElement.props.size, 18);
  assert.equal(iconElement.props.color, "#475569");
  assert.deepEqual(JSON.parse(JSON.stringify(iconElement.props.style)), [{ flexShrink: 0 }, style]);
  assert.equal(iconElement.props.accessible, false);
});

const homeIconCases = [
  ["Current Outstanding", "wallet-outline"],
  ["Total Udhari", "arrow-up-circle-outline"],
  ["Total Money Received", "arrow-down-circle-outline"],
  ["Udhari Recovered", "checkmark-circle-outline"],
  ["Available Advances", "wallet-outline"],
  ["Advance Deposited", "cash-outline"],
  ["Advance Refunded", "return-down-back-outline"],
  ["Customers", "people-outline"],
  ["This month’s udhari", "arrow-up-outline"],
  ["This month’s collection", "arrow-down-outline"],
];

test("Home dashboard cards pass visible, valid Ionicons to the stat renderer", () => {
  assert.ok(homeScreen.length > 0, "Home screen JSX must exist");
  for (const [label, icon] of homeIconCases) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      homeScreen,
      new RegExp(`stat\\(\\s*"${escapedLabel}"[\\s\\S]{0,350}?true,\\s*"${icon}"\\s*,?\\s*\\)`),
      `${label} should pass its intended icon through stat(...)`,
    );
    assert.ok(Object.hasOwn(ionicons, icon), `${icon} is absent from installed Ionicons glyph map`);
  }
  assert.match(appSource, /<Icon name=\{icon\} color=\{palette\.text\} size=\{18\} style=\{customerDetailsStyles\.summaryIcon\} \/>/);
});

test("Home quick actions and section headings render their icons", () => {
  assert.match(appSource, /icon="arrow-up-outline" title="\+ Give Udhari"/);
  assert.match(appSource, /icon="arrow-down-outline" title="Receive Money \/ Add Advance"/);
  assert.match(homeScreen, /icon="person-add-outline"[\s\S]{0,100}title="\+ Add Customer"/);
  assert.match(homeScreen, /name="time-outline" size=\{18\} color=\{colors\.dark\}/);
  assert.match(homeScreen, /name="people-outline" size=\{18\} color=\{colors\.dark\}/);
  assert.match(homeScreen, /\.map\(\(entry\) => entryRow\(entry\)\)/);
  for (const icon of ["arrow-up-outline", "arrow-down-outline", "person-add-outline", "time-outline", "people-outline"]) {
    assert.ok(Object.hasOwn(ionicons, icon), `${icon} is absent from installed Ionicons glyph map`);
  }
});

test("filter chips render all five intended icons with compact accessible styling", () => {
  const chipsStart = uiSource.indexOf("export function Chips(");
  const chipsEnd = uiSource.indexOf("export function LanguagePicker(", chipsStart);
  const chipsSource = uiSource.slice(chipsStart, chipsEnd);
  const filterIcons = [
    ["All", "grid-outline", "colors.neutral"],
    ["Udhari", "arrow-up-circle-outline", "colors.red"],
    ["Payment", "wallet-outline", "colors.green"],
    ["Due", "time-outline", "colors.orange"],
    ["Paid", "checkmark-circle-outline", "colors.green"],
  ];
  assert.ok(chipsStart >= 0 && chipsEnd > chipsStart, "Chips renderer must exist");
  for (const [label, icon, color] of filterIcons) {
    assert.match(chipsSource, new RegExp(`${label}: \\{ name: "${icon}", color: ${color} \\}`));
    assert.ok(Object.hasOwn(ionicons, icon), `${icon} is absent from installed Ionicons glyph map`);
  }
  assert.match(chipsSource, /<Icon[\s\S]*?size=\{17\}[\s\S]*?color=\{value === item \? "white" : filterIcons\[item\]!\.color\}/);
  assert.match(chipsSource, /accessibilityRole="button"[\s\S]*?accessibilityLabel=\{item\}[\s\S]*?accessibilityState=\{\{ selected: value === item \}\}/);
  assert.match(uiSource, /chipContent: \{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 \}/);
  assert.match(uiSource, /chipIcon: \{ width: 17, height: 17, flexShrink: 0 \}/);
});

test("Customers Add Customer action stays once in the virtualized list footer", () => {
  const customersStart = appSource.indexOf('case "customers": {');
  const manageStart = appSource.indexOf('case "manageCustomers": {', customersStart);
  const customersSource = appSource.slice(customersStart, manageStart);
  assert.match(customersSource, /footer: <>[\s\S]*?listFooter\(page\.hasMore, "Loading more customers\.\.\."\)[\s\S]*?icon="person-add-outline" title="\+ Add Customer" onPress=\{\(\) => go\("customerForm"\)\}/);
  assert.equal((customersSource.match(/title="\+ Add Customer"/g) || []).length, 1);
  assert.doesNotMatch(customersSource, /virtualizedTop/);
});
