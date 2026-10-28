import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import loadTs from './helpers/loadTs.cjs';
import { LOCALES } from '../src/locales.ts';
import { CustomerActionGate } from '../src/customerActionGate.ts';
import { customerLifecycleState, transitionCustomerLifecycle, matchesCustomerLifecycleFilter } from '../src/customerLifecycle.ts';
import { visiblePage, nextVisibleCount, PAGE_SIZE, UserScrollPageGate } from '../src/pagination.ts';

const appSource = readFileSync('App.tsx', 'utf8');
const ast = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function appFunction(name, scope) {
  let found;
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(ast) === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `App function ${name} exists`);
  const code = ts.transpileModule((ts.isVariableDeclaration(found) ? "const " : "") + found.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${code}\nreturn ${name};`)(...Object.values(scope));
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const customer = { id: 'c1', name: 'Test', status: true, disabled: false, removed: false, opening: 40, serverVersion: 2 };
function actionHarness(commit) {
  let saving = {};
  const alerts = [];
  const dataRef = { current: { signedIn: true, customers: [customer], audit: [] } };
  const gate = new CustomerActionGate();
  const scope = {
    customerLifecycleState, transitionCustomerLifecycle,
    balance: () => 40, data: dataRef.current, dataRef,
    customerActionGate: { current: gate }, offlineAccountRef: { current: 'account' },
    activeLanguageRef: { current: 'en' },
    setSavingCustomers: update => { saving = update(saving); },
    commit, Alert: { alert: (...args) => alerts.push(args) },
    t: text => text, money: value => String(value), uid: () => 'event', errorMessage: (_, fallback) => fallback,
  };
  return { change: appFunction('changeCustomerLifecycle', scope), alerts, dataRef, gate, saving: () => saving };
}

test('confirmation, duplicate taps, dismissal and retry use one reservation per customer', () => {
  const gate = new CustomerActionGate();
  const first = gate.reserve('c1');
  assert.equal(gate.reserve('c1'), null);
  assert.ok(gate.reserve('c2'));
  gate.cancel(first);
  const second = gate.reserve('c1');
  assert.equal(gate.confirm(first), false);
  assert.equal(gate.confirm(second), true);
  assert.equal(gate.confirm(second), false);
  gate.cancel(second); // Android dismissal must not unlock an in-progress save.
  assert.equal(gate.reserve('c1'), null);
  gate.finish(second);
  assert.ok(gate.reserve('c1'));
});

test('actual lifecycle handler shows per-customer busy state until local persistence completes', async () => {
  let resolveSave;
  const writes = [];
  const harness = actionHarness(next => { writes.push(next); return new Promise(resolve => { resolveSave = resolve; }); });
  harness.change(customer, 'disabled');
  harness.change(customer, 'removed');
  assert.equal(harness.alerts.length, 1, 'only one confirmation may open');
  const confirm = harness.alerts[0][2][1].onPress;
  // A concurrent update while the dialog is open must not be replaced by its old snapshot.
  harness.dataRef.current = { ...harness.dataRef.current, customers: [{ ...customer, opening: 75 }, { ...customer, id: 'c2' }] };
  confirm(); confirm();
  assert.deepEqual(harness.saving(), { c1: 'disabled' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].customers.length, 2);
  assert.equal(writes[0].customers[0].opening, 75);
  assert.equal(writes[0].customers[0].serverVersion, 2);
  resolveSave(true);
  await flush();
  assert.deepEqual(harness.saving(), {});
  assert.equal(harness.alerts.at(-1)[0], 'Customer disabled');
});

for (const failure of ['false', 'throw']) test(`action ${failure} failure clears loader and allows retry`, async () => {
  const harness = actionHarness(async () => { if (failure === 'throw') throw Error('synthetic'); return false; });
  harness.change(customer, 'disabled');
  harness.alerts[0][2][1].onPress();
  await flush();
  assert.deepEqual(harness.saving(), {});
  assert.ok(harness.gate.reserve(customer.id));
  assert.ok(!harness.alerts.some(args => args[0] === 'Customer disabled'));
  if (failure === 'throw') assert.equal(harness.alerts.at(-1)[0], 'Unable to save');
});

test('commit resolves after encrypted local save while background sync remains pending', async () => {
  const before = { signedIn: true, customers: [customer] };
  const after = { ...before, customers: [transitionCustomerLifecycle(customer, 'disabled')] };
  const calls = [];
  const commit = appFunction('commit', {
    loadError: false, dataRef: { current: before }, writeQueue: { current: Promise.resolve(true) },
    persistedRef: { current: before }, offlineAccountRef: { current: 'account' }, localRevision: { current: 0 },
    offlineStorageAvailable: () => true,
    saveLocalChange: async (account, previous, next) => { calls.push('persist-and-queue'); assert.equal(next, after); return 'operation'; },
    refreshSyncStatus: async () => {}, setData: () => {},
    synchronizeAccount: () => { calls.push('background-sync'); return new Promise(() => {}); },
  });
  assert.equal(await commit(after), true);
  assert.deepEqual(calls, ['persist-and-queue', 'background-sync']);
});

test('tabs and search immediately page only matching records, starting with fifteen after restart', () => {
  const records = Array.from({ length: 96 }, (_, id) => ({ ...customer, id: String(id), name: `Customer ${id}`, phone: '', ...[
    { status: true, disabled: false, removed: false }, { status: false, disabled: true, removed: false }, { status: false, disabled: false, removed: true },
  ][id % 3] }));
  for (const tab of ['All', 'Disabled', 'Removed', 'All']) {
    for (const search of ['', '9', 'no match', '']) {
      const matching = records.filter(c => matchesCustomerLifecycleFilter(c, tab) && c.name.toLowerCase().includes(search));
      let count = PAGE_SIZE;
      const gate = new UserScrollPageGate();
      assert.equal(gate.claimPage(), false);
      assert.equal(visiblePage(matching, count).items.length, Math.min(15, matching.length));
      gate.beginUserScroll(); gate.markUserMovement();
      if (gate.claimPage()) count = nextVisibleCount(count, matching.length);
      assert.equal(gate.claimPage(), false);
      assert.equal(new Set(visiblePage(matching, count).items.map(c => c.id)).size, Math.min(30, matching.length));
    }
  }
});

test('shared Button uses the existing native spinner and marks loading actions disabled and busy', () => {
  const { Button, colors } = loadTs('src/ui.tsx', {
    'react-native': { Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: value => value } },
    './i18n': { Text: 'Text' }, '@expo/vector-icons/Ionicons': {},
  });
  for (const secondary of [false, true]) {
    const button = Button({ title: 'Disable Customer', onPress() {}, secondary, loading: true });
    assert.equal(button.props.disabled, true);
    assert.deepEqual(button.props.accessibilityState, { disabled: true, busy: true });
    assert.equal(button.props.children[0].type, 'ActivityIndicator');
    assert.equal(button.props.children[0].props.color, secondary ? colors.green : 'white');
    assert.equal(button.props.children[1].props.children, 'Disable Customer');
  }
  assert.equal(Button({ title: 'View Customer', onPress() {} }).props.disabled, false);
});

test('mobile customer details action uses the existing localized label and preserves its route and icon', () => {
  const managedCustomerRow = appSource.slice(appSource.indexOf('const managedCustomerRow ='), appSource.indexOf('const transactionRow ='));
  assert.match(managedCustomerRow, /icon="person-outline" title=\{t\("View Customer", data\.language\)\} secondary onPress=\{\(\) => go\("customer", c\.id\)\}/);
});

test('loading UI remains tied to startup, real rendering work, and the current list key', () => {
  const manage = appSource.slice(appSource.indexOf('case "manageCustomers": {'), appSource.indexOf('case "customerForm":'));
  assert.match(manage, /empty: !loaded \?/);
  assert.match(manage, /listFooter\(page.hasMore, ""\)/);
  assert.match(appSource, /if \(!loaded && !data.signedIn\)/);
  assert.match(appSource, /startCustomerPageTransition\(/);
  assert.match(appSource, /setListPage\(\(previous\) => listPageKeyRef.current === current.key/);
  assert.match(appSource, /customerPageRequest.current\?\.key === current.key/);
  assert.doesNotMatch(manage, /fetch\(|setTimeout\(|loadAccount\(/);
});


test('actual deferred pagination rejects duplicates and stale results after a tab/search switch', () => {
  const transitionUpdates = [];
  const scope = {
    listPageRef: { current: { key: 'All:', count: 15, total: 60, loading: false } },
    listPageKeyRef: { current: 'All:' }, listHasScrolled: { current: true },
    route: { screen: 'manageCustomers' }, nextVisibleCount,
    customerPageRequest: { current: null },
    startCustomerPageTransition: callback => callback(),
    setListPage: update => transitionUpdates.push(update),
  };
  const request = appFunction('requestNextVisiblePage', scope);
  request(); request();
  assert.equal(transitionUpdates.length, 1);
  const page = { key: 'All:', count: 15, loading: false };
  assert.deepEqual(transitionUpdates[0](page), { key: 'All:', count: 30, loading: false });
  scope.listPageKeyRef.current = 'Disabled:new-search';
  const newPage = { key: 'Disabled:new-search', count: 15, loading: false };
  assert.equal(transitionUpdates[0](newPage), newPage, 'old page work cannot overwrite a new tab/search');
});

test('all 23 languages cover reused action and error labels; loaders add no English-only text', () => {
  assert.equal(LOCALES.length, 23);
  const { translate } = loadTs('src/i18n.tsx', { 'react-native': { Text: 'Text', Alert: {} } });
  const keys = ['Disable Customer', 'Enable Customer', 'Remove Customer', 'Restore Customer', 'Unable to save', 'Please try again.'];
  for (const locale of LOCALES) {
    if (locale.id === 'en') continue;
    for (const key of keys) assert.notEqual(translate(key, locale.id), key, `${locale.id}: ${key}`);
  }
});
