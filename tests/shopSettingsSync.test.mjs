import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { apiErrorTranslationKey } from "../src/localization.ts";
import { shouldSyncShopSettings } from "../src/settingsSync.ts";
import { isShopSettingsConflict, sameShopValues } from "../server/src/utils/records.js";

const server = (overrides = {}) => ({
  name: "Shop",
  owner: "Owner",
  address: "Address",
  phone: "+919876543210",
  whatsapp: "9876543210",
  defaultMethod: "Cash",
  reminders: { enabled: true, day: "Last day", time: "10:00", minimum: "0", whatsapp: false, sms: false },
  language: "English",
  ...overrides,
});
const shopProfile = (overrides = {}) => {
  const { language: _language, ...profile } = server(overrides);
  return profile;
};

test("matching settings versions allow a shop settings update", () => {
  const current = server();
  assert.equal(isShopSettingsConflict({
    current,
    input: server({ address: "New address" }),
    base: { success: true, data: current },
    actualVersion: 4,
    baseVersion: 4,
    actualResolutionVersion: 2,
    baseResolutionVersion: 2,
  }), false);
});

test("stale versions still conflict when the server has a different shop value", () => {
  assert.equal(isShopSettingsConflict({
    current: server({ address: "Server address" }),
    input: server({ address: "Phone address" }),
    base: null,
    actualVersion: 5,
    baseVersion: 4,
    actualResolutionVersion: 2,
    baseResolutionVersion: 2,
  }), true);
});

test("language-only selection and preference restoration do not create server settings deltas", () => {
  const before = { shop: shopProfile(), language: "en", defaultMethod: "Cash", reminders: server().reminders };
  const selected = { ...before, language: "ta" };
  assert.equal(shouldSyncShopSettings(before, selected), false);
  assert.equal(shouldSyncShopSettings(selected, { ...selected }), false);

  const app = readFileSync("App.tsx", "utf8");
  const selector = app.match(/function selectLanguage\(language: string\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.match(selector, /saveLanguagePreference\(language\)/);
  assert.match(selector, /saveLocalLanguagePreference\(accountId, language\)/);
  assert.doesNotMatch(selector, /commit\(|synchronizeAccount\(/);
  const restore = app.match(/readLanguagePreference\(\)\.then\(\(language\) => \{([\s\S]*?)\n    \}\)/)?.[1] || "";
  assert.doesNotMatch(restore, /commit\(|synchronizeAccount\(/);
});

test("real shop-setting edits remain queued, but legacy language-only updates are discarded", () => {
  const before = { shop: shopProfile(), language: "en", defaultMethod: "Cash", reminders: server().reminders };
  const edited = { ...before, shop: shopProfile({ address: "New address" }), language: "bn" };
  assert.equal(shouldSyncShopSettings(before, edited), true);
  assert.equal(shouldSyncShopSettings(before, { ...before, language: "bn" }), false);
  const delta = readFileSync("src/syncDelta.ts", "utf8");
  assert.match(delta, /const serverSettingsChanged = settings &&\s*shouldSyncShopSettings\(settings\.before, settings\.after\)/);
  assert.match(delta, /shouldSyncShopSettings\(before, after\) \? \{ settings: \{ before, after \} \}/);
});

test("a language-only difference is excluded from optimistic shop comparison", () => {
  assert.equal(sameShopValues(server({ language: "ta" }), shopProfile()), true);
  assert.equal(sameShopValues(server({ address: "Server" }), shopProfile({ address: "Phone" })), false);
  assert.equal(sameShopValues(server({ language: "ta" }), shopProfile({ address: "Phone" })), false);
});

test("settings conflicts receive a stable localized error code", () => {
  assert.equal(apiErrorTranslationKey("SHOP_SETTINGS_CONFLICT", 409), "Settings changed again");
  const controller = readFileSync("server/src/controllers/shopController.js", "utf8");
  assert.match(controller, /code: e\.code \|\| "SHOP_SETTINGS_CONFLICT"/);
  assert.match(controller, /type: "shop_settings_conflict"/);
  const api = readFileSync("src/api.ts", "utf8");
  const syncBody = api.match(/const payload = \(value: typeof settings\) => \(([\s\S]*?)\n    \}\);/)?.[1] || "";
  assert.doesNotMatch(syncBody, /language:/);
  const resolution = api.match(/export async function resolveSettingsConflict[\s\S]*?const result = await request/)?.[0] || "";
  assert.doesNotMatch(resolution, /language: conflict\.local\.language/);
});

test("a rejected settings update is parked as a conflict, never retried as pending", () => {
  const sync = readFileSync("src/offlineSync.ts", "utf8");
  const store = readFileSync("src/offlineStore.ts", "utf8");
  assert.match(sync, /error\.status === 409[\s\S]*?markSettingsConflict\(pending\.id/);
  assert.match(store, /state = 'conflict', conflict_json = \?, attempts = attempts \+ 1/);
  assert.match(store, /state = 'pending' ORDER BY id/);
  assert.match(store, /UPDATE local_accounts SET shop_json = \?, preferences_json = \?, updated_at = \? WHERE account_id = \?/);
  assert.match(sync, /catch \(error\) \{\s*\/\/ A concurrent caller must not turn[\s\S]*?throw error;/);
});

test("local language persistence updates preferences only and does not replace financial records", () => {
  const store = readFileSync("src/offlineStore.ts", "utf8");
  const save = store.match(/export async function saveLocalLanguagePreference[\s\S]*?\n\}/)?.[0] || "";
  assert.match(save, /SELECT preferences_json FROM local_accounts/);
  assert.match(save, /UPDATE local_accounts SET preferences_json/);
  assert.doesNotMatch(save, /local_customers|local_ledger|sync_queue/);
});
