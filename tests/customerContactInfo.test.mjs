import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { readFileSync } from 'node:fs';
import loadTs from './helpers/loadTs.cjs';

const calls = [], alerts = [];
let fail = () => false;
const actions = loadTs('src/customerContactActions.ts', { 'react-native': {
  Linking: { openURL: async (url) => { calls.push(url); if (fail(url)) throw new Error('Unavailable'); } },
  Alert: { alert: (...args) => alerts.push(args) },
} });
const { customerContactUrls: urls, openCustomerContact: open } = actions;
const Icon = () => null;
const { CustomerContactInfo } = loadTs('src/CustomerContactInfo.tsx', {
  react: { ...React, useContext: () => 'en' },
  'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: (s) => s } },
  './ui': { Icon, colors: { green: '#15803D', muted: '#475569' }, s: { small: {}, rowTitle: {} } },
  './i18n': { LanguageContext: {}, Text: 'Text', t: (s) => s },
  './customerContactActions': actions,
});
const customer = Object.freeze({ phone: '9876543210', whatsappNumber: '8765432109', address: 'Gandhi Maidan, Gaya & Bihar #2' });
const rows = (props = {}) => CustomerContactInfo({ customer, ...props }).props.children[0].props.children.filter(Boolean);
const glyphs = JSON.parse(readFileSync('node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json', 'utf8'));

test('phone URL opens the dialer with normalized Indian country code', () => {
  for (const input of ['9876543210', '+91 98765-43210', '00919876543210', '09876543210']) {
    assert.deepEqual(urls('phone', input), ['tel:+919876543210']);
  }
});
test('WhatsApp uses its independent saved number and encodes optional draft text', () => {
  assert.deepEqual(urls('whatsapp', customer.whatsappNumber), ['whatsapp://send?phone=918765432109', 'https://wa.me/918765432109']);
  assert.equal(urls('whatsapp', '+91 8765432109', 'Hello & नमस्ते?')[1], `https://wa.me/918765432109?text=${encodeURIComponent('Hello & नमस्ते?')}`);
});
test('Maps uses fixed HTTPS host and encodes address only as search data', () => {
  for (const address of [customer.address, 'गया, बिहार\nIndia', 'https://evil.example/?a=1&b=2', 'javascript:alert(1)']) {
    const url = new URL(urls('address', address)[0]);
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('query'), address);
    assert.equal(url.searchParams.size, 2);
  }
});
test('missing, invalid and injected numbers never generate actionable URLs', () => {
  for (const kind of ['phone', 'whatsapp']) for (const value of [undefined, null, '', ' ', '123', '5123456789', '9876543210?x=y', 'tel:+919876543210', '9876543210;123']) assert.deepEqual(urls(kind, value), []);
  for (const value of [undefined, '', ' ', '\u0000', 'a'.repeat(501), '\ud800']) assert.deepEqual(urls('address', value), []);
});
test('all contact icons render from installed Ionicons in full and compact layouts', () => {
  for (const compact of [false, true]) {
    const rendered = rows({ compact });
    assert.equal(rendered.length, 3);
    for (const [index, name] of ['call-outline', 'logo-whatsapp', 'location-outline'].entries()) {
      const icon = rendered[index].props.children[0];
      assert.equal(icon.type, Icon); assert.equal(icon.props.name, name);
      assert.ok(Object.hasOwn(glyphs, name)); assert.equal(icon.props.size, 18);
      assert.equal(rendered[index].props.accessibilityRole, 'link');
      assert.equal(rendered[index].props.style({ pressed: false })[0].minHeight, 48);
    }
  }
});
test('missing contacts keep three unavailable buttons in both layouts', () => {
  const empty = { phone: '', address: '' };
  assert.equal(rows({ customer: empty, compact: true }).length, 3);
  for (const row of rows({ customer: empty })) {
    assert.equal(row.props.accessibilityState.disabled, true);
    assert.match(row.props.accessibilityLabel, /Not added/);
  }
  const noWhatsApp = rows({ customer: { ...customer, whatsappNumber: undefined } });
  assert.equal(noWhatsApp[1].props.accessibilityState.disabled, true);
  assert.equal(rows({ customer: { ...customer, phone: 'invalid', whatsappNumber: '123' } })[0].props.accessibilityState.disabled, true);
});
test('transaction-details keeps all compact contact icons and disables unavailable actions', () => {
  const onlyPhone = rows({ customer: { phone: customer.phone, whatsappNumber: '', address: '' }, compact: true });
  assert.equal(onlyPhone.length, 3);
  assert.equal(onlyPhone[0].props.children[0].props.name, 'call-outline');
  assert.equal(onlyPhone[1].props.children[0].props.name, 'logo-whatsapp');
  assert.equal(onlyPhone[1].props.accessibilityState.disabled, true);
  assert.equal(onlyPhone[2].props.accessibilityState.disabled, true);
  const none = rows({ customer: { phone: '', whatsappNumber: '', address: '' }, compact: true });
  assert.equal(none.length, 3);
  assert.ok(none.every((action) => action.props.accessibilityState.disabled));
});
test('contact taps do not trigger parent navigation or change customer records', async () => {
  fail = () => false; calls.length = 0;
  let stopped = 0;
  for (const row of rows()) row.props.onPress({ stopPropagation: () => stopped++ });
  await Promise.resolve();
  assert.equal(stopped, 3);
  assert.deepEqual(calls, ['tel:+919876543210', 'whatsapp://send?phone=918765432109', urls('address', customer.address)[0]]);
  assert.equal(customer.phone, '9876543210');
  assert.equal(customer.whatsappNumber, '8765432109');
});
test('WhatsApp app failure falls back to click-to-chat without crashing', async () => {
  calls.length = 0; alerts.length = 0; fail = (url) => url.startsWith('whatsapp:');
  assert.equal(await open('whatsapp', customer.whatsappNumber), true);
  assert.deepEqual(calls, urls('whatsapp', customer.whatsappNumber)); assert.equal(alerts.length, 0);
});
test('unavailable apps, offline failures and malformed details show safe feedback', async () => {
  fail = () => true;
  for (const kind of ['phone', 'whatsapp', 'address']) {
    calls.length = 0; alerts.length = 0;
    assert.equal(await open(kind, customer[kind === 'whatsapp' ? 'whatsappNumber' : kind]), false);
    assert.equal(alerts.length, 1);
    assert.ok(!JSON.stringify(alerts).includes(customer.phone));
  }
  calls.length = 0;
  assert.equal(await open('phone', 'not-a-number'), false); assert.equal(calls.length, 0);
  fail = () => false;
});
test('full details preserve complete values and long addresses can wrap', () => {
  const tree = CustomerContactInfo({ customer, inverse: true });
  const details = tree.props.children[1].props.children;
  assert.deepEqual(details.map((row) => row.props.children[1].props.children), [customer.phone, customer.whatsappNumber, customer.address]);
  assert.equal(details[2].props.children[1].props.numberOfLines, undefined);
  assert.equal(CustomerContactInfo({ customer, compact: true }).props.children[1], false);
});
test('profile detail rows pair each existing icon action with its label and saved value', () => {
  const tree = CustomerContactInfo({ customer, detailRows: true });
  const rows = tree.props.children[0].props.children;
  assert.equal(rows.length, 3);
  for (const [index, iconName, label, value] of [
    [0, 'call-outline', 'Mobile Number', customer.phone],
    [1, 'logo-whatsapp', 'WhatsApp Number', customer.whatsappNumber],
    [2, 'location-outline', 'Address', customer.address],
  ]) {
    const row = rows[index];
    const [iconWrap, copy] = row.props.children;
    assert.equal(iconWrap.props.children.props.name, iconName);
    assert.equal(copy.props.children[0].props.children, label);
    assert.equal(copy.props.children[1].props.children, value);
    assert.equal(row.props.accessibilityRole, 'link');
    assert.equal(row.props.accessibilityState.disabled, false);
    const style = Object.assign({}, ...row.props.style({ pressed: false }).filter(Boolean));
    assert.equal(style.minHeight, 68);
  }
  assert.equal(tree.props.children[1], false);
});
test('profile detail rows keep missing contacts visible, labeled, and disabled', () => {
  const tree = CustomerContactInfo({ customer: { phone: '', whatsappNumber: undefined, address: '' }, detailRows: true });
  const rows = tree.props.children[0].props.children;
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.props.accessibilityState.disabled, true);
    const value = row.props.children[1].props.children[1].props.children;
    assert.equal(value, 'Not added');
  }
});
test('all identified customer contact display sites use the shared renderer', () => {
  const source = readFileSync('App.tsx', 'utf8');
  assert.equal((source.match(/<CustomerContactInfo /g) || []).length, 8);
  assert.doesNotMatch(source, /<Text[^>]*>\{(?:c|customer)\??\.(?:phone|address)\}/);
  assert.match(source, /openCustomerContact\("whatsapp", customer.whatsappNumber, form.message\)/);
});


test('contact cards use distinct blue, green and orange palettes', () => {
  for (const compact of [false, true]) {
    const rendered = rows({ compact });
    for (const [index, background, border, icon, text] of [
      [0, '#EFF6FF', '#BFDBFE', '#2563EB', '#1E40AF'],
      [1, '#ECFDF5', '#A7F3D0', '#16A34A', '#166534'],
      [2, '#FFF7ED', '#FED7AA', '#EA580C', '#9A3412'],
    ]) {
      assert.deepEqual(rendered[index].props.style({ pressed: false })[1], { backgroundColor: background, borderColor: border });
      assert.equal(rendered[index].props.children[0].props.color, icon);
      assert.equal(rendered[index].props.children[1].props.style[1].color, text);
    }
  }
});
test('all three equal buttons stay in one row with bounded labels on narrow screens', () => {
  for (const compact of [false, true]) {
    const actions = CustomerContactInfo({ customer, compact }).props.children[0];
    assert.equal(actions.props.style.flexDirection, 'row');
    assert.equal(actions.props.style.flexWrap, 'nowrap');
    assert.equal(actions.props.children.length, 3);
    for (const [index, button] of actions.props.children.entries()) {
      const style = Object.assign({}, ...button.props.style({ pressed: false }).filter(Boolean));
      assert.equal(style.flex, 1);
      assert.equal(style.minWidth, 0);
      assert.equal(style.minHeight, 48);
      assert.equal(style.width, undefined);
      const label = button.props.children[1];
      assert.equal(label.props.children, ['Phone', 'WhatsApp', 'Address'][index]);
      assert.equal(label.props.numberOfLines, 1);
      assert.equal(label.props.adjustsFontSizeToFit, true);
      assert.equal(label.props.style[0].width, '100%');
    }
  }
});

test('compact contact actions remain visible but disabled when customer contact values are missing or invalid', () => {
  const missing = rows({ customer: { phone: '', whatsappNumber: '', address: '' }, compact: true });
  assert.equal(missing.length, 3);
  assert.deepEqual(missing.map((button) => button.props.accessibilityState.disabled), [true, true, true]);
  const invalid = rows({ customer: { phone: '123', whatsappNumber: '9876543210', address: '' }, compact: true });
  assert.deepEqual(invalid.map((button) => button.props.accessibilityState.disabled), [true, false, true]);
});
