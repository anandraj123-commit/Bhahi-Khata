import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import loadTs from './helpers/loadTs.cjs';
const require = createRequire(import.meta.url);
const Icon = () => null;
const { TransactionTypeBadge } = loadTs('src/TransactionTypeBadge.tsx', {
  react: { ...React, useContext: () => 'en' },
  'react-native': { View: 'View', StyleSheet: { create: (s) => s } },
  './ui': { Icon }, './i18n': { LanguageContext: {}, Text: 'Text', t: (s) => s },
});
const glyphs = JSON.parse(readFileSync('node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json', 'utf8'));
for (const [label, background, text, icon] of [
  ['Udhari Given', '#FEF2F2', '#B91C1C', 'arrow-up-circle-outline'],
  ['Payment Received', '#ECFDF5', '#047857', 'cash-outline'],
  ['Udhari Recovered', '#EFF6FF', '#1D4ED8', 'checkmark-circle-outline'],
  ['Advance Deposited', '#F0FDF4', '#15803D', 'wallet-outline'],
  ['Advance Refunded', '#FFF7ED', '#C2410C', 'return-up-back-outline'],
  ['Advance Refund', '#FFF7ED', '#C2410C', 'return-up-back-outline'],
]) test(`${label} has a themed badge and a supported icon`, () => {
  for (const compact of [false, true]) {
    const tree = TransactionTypeBadge({ label, compact });
    assert.equal(tree.props.accessibilityLabel, label);
    assert.equal(tree.props.style[1].backgroundColor, background);
    assert.equal(tree.props.children[0].props.name, icon);
    assert.ok(Object.hasOwn(glyphs, icon));
    assert.equal(tree.props.children[1].props.style[1].color, text);
    assert.equal(tree.props.children[1].props.children, label);
    assert.equal(tree.props.style[0].maxWidth, '100%');
    assert.equal(tree.props.children[1].props.style[0].flexShrink, 1);
  }
});
test('unknown labels render safely with a neutral badge', () => {
  for (const label of ['Unknown', '__proto__', '']) {
    const tree = TransactionTypeBadge({ label });
    assert.equal(tree.props.children[0].props.name, 'receipt-outline');
    assert.equal(tree.props.accessibilityLabel, label || 'Transaction');
  }
});
test('Home uses existing labels and unchanged amounts, dates and navigation', () => {
  const app = readFileSync('App.tsx', 'utf8');
  const start = app.indexOf('  const entryRow =');
  const end = app.indexOf('  async function saveCustomer()', start);
  const { transactionLabel: entryLabel } = loadTs('src/entryPresentation.ts');
  const compiled = ts.transpileModule(app.slice(start, end) + '\nexports.entryRow = entryRow;', { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const navigations = [];
  const mocked = {
    React, Pressable: 'Pressable', View: 'View', Text: 'Text', Card: 'Card', Icon,
    TransactionTypeBadge, CustomerContactInfo: 'Contact', entryLabel,
    data: { customers: [{ id: 'c', name: 'A long customer name', phone: '', address: '' }], language: 'en' },
    s: {}, customerDetailsStyles: {}, financialPalette: { red: { text: 'red' }, amber: { text: 'orange' }, green: { text: 'green' } },
    go: (...args) => navigations.push(args),
    money: (amount) => `₹${amount}`, transactionAmountText: (e, format) => format(Math.abs(e.amount)),
    entryDateTime: () => '25 Oct, 10:30 AM', localeTag: () => 'en-IN',
  };
  const exports = {};
  new Function('require', 'exports', ...Object.keys(mocked), compiled)(require, exports, ...Object.values(mocked));
  const all = (node) => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(all)];
  for (const [type, label] of [['credit', 'Udhari Given'], ['payment', 'Payment Received'], ['refund', 'Advance Refund']]) {
    const entry = Object.freeze({ id: type, customerId: 'c', type, amount: 1500.25, appliedToUdhari: 1000, addedToAdvance: 500.25 });
    const home = exports.entryRow(entry, false, true);
    const nodes = all(home);
    assert.equal(nodes.find((node) => node.type === TransactionTypeBadge).props.label, label);
    assert.ok(nodes.some((node) => node.props.children === '₹1500.25'));
    assert.ok(nodes.some((node) => React.Children.toArray(node.props.children).includes('25 Oct, 10:30 AM')));
    home.props.onPress();
    assert.deepEqual(navigations.at(-1), ['transaction', type]);
    assert.equal(all(exports.entryRow(entry, true)).some((node) => node.type === TransactionTypeBadge), false);
    assert.equal(entry.amount, 1500.25);
  }
});
