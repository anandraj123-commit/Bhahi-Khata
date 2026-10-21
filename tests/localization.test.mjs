import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { LOCALES, LOCALE_IDS, localeDirection, localeId, localeTag } from "../src/locales.ts";
import {
  localeDictionaries,
  CORE_TRANSLATION_KEYS,
  BATCH2_CORE_KEYS,
  BATCH3_GROUP1_KEYS,
  BATCH3_GROUP2_KEYS,
  BATCH3_GROUP3_KEYS,
  BATCH3_GROUP4_KEYS,
  BATCH3_GROUP5_KEYS,
  BATCH3_GROUP6_KEYS,
  BATCH3_GROUP7_KEYS,
  BATCH4_GROUP1_KEYS,
  BATCH4_GROUP2_KEYS,
  BATCH4_GROUP3_KEYS,
  BATCH4_GROUP4_KEYS,
  BATCH4_GROUP5_KEYS,
  BATCH4_GROUP6_KEYS,
  BATCH4_GROUP7_KEYS,
  BATCH4_GROUP8_KEYS,
  BATCH4_GROUP9_KEYS,
  BATCH4_GROUP10_KEYS,
  BATCH4_GROUP11_KEYS,
  BATCH4_GROUP12_KEYS,
  BATCH4_GROUP13_KEYS,
} from "../src/translations.ts";
import { APP_RUNTIME_TRANSLATION_KEYS, APP_STATIC_TRANSLATION_KEYS } from "../src/translationInventory.ts";
import { customerLifecycleTranslations } from "../src/customerLifecycleTranslations.ts";
import {
  formatCurrency,
  formatLocaleDate,
  interpolate,
  apiErrorTranslationKey,
  measureTranslationCoverage,
  pluralTemplate,
  resolveLocaleText,
} from "../src/localization.ts";

test("the language selector catalog contains all 23 unique Indian locale IDs and native names", () => {
  assert.equal(LOCALES.length, 23);
  assert.equal(new Set(LOCALE_IDS).size, 23);
  assert.deepEqual(LOCALE_IDS, ["en", "hi", "bn", "mr", "te", "ta", "gu", "ur", "kn", "ml", "or", "pa", "as", "mai", "sat", "ks", "ne", "kok", "sd", "doi", "mni", "brx", "sa"]);
  for (const locale of LOCALES) {
    assert.ok(locale.nativeName.trim());
    assert.match(locale.tag, /^[a-z]{2,3}-IN$/);
  }
});

test("legacy language values normalize to BCP 47 locale entries", () => {
  assert.equal(localeId("English"), "en");
  assert.equal(localeId("हिन्दी"), "hi");
  assert.equal(localeTag("bn"), "bn-IN");
  assert.equal(localeId("unknown"), "en");
});

test("core dictionaries contain actual translations and missing keys fall back to source English", () => {
  for (const [id, dictionary] of Object.entries(localeDictionaries)) {
    assert.ok(LOCALE_IDS.includes(id));
    assert.ok(Object.keys(dictionary).length > 0);
    for (const [key, translated] of Object.entries(dictionary)) {
      assert.ok(translated.trim());
      const approvedUntranslatedTerms = new Set(["SMS", "WhatsApp"]);
      if (!approvedUntranslatedTerms.has(key))
        assert.notEqual(translated, key, `${id}:${key} must not be an English placeholder`);
    }
  }
  assert.ok(CORE_TRANSLATION_KEYS.length >= 10);
  assert.equal(resolveLocaleText("Not translated yet", localeDictionaries.bn), "Not translated yet");
  assert.equal(resolveLocaleText("  Due  ", localeDictionaries.mr), "  बाकी  ");
});

test("Batch 1 Hindi dictionary includes every shared core label", () => {
  for (const key of CORE_TRANSLATION_KEYS) {
    assert.ok(localeDictionaries.hi[key]?.trim(), `hi:${key} is missing`);
  }
});

test("Batch 2 core terms exist as real translations in Bengali, Marathi, Tamil, Telugu, Gujarati and Punjabi", () => {
  const locales = ["bn", "mr", "ta", "te", "gu", "pa"];
  assert.ok(BATCH2_CORE_KEYS.length >= 70);
  for (const locale of locales) {
    for (const key of BATCH2_CORE_KEYS) {
      const value = localeDictionaries[locale][key];
      assert.ok(value?.trim(), `${locale}:${key} is missing`);
      assert.notEqual(value, key, `${locale}:${key} must not use English fallback`);
    }
  }
});

test("Batch 2 translations use each locale's writing system for native-script labels", () => {
  const samples = { bn: "Customers", mr: "Customers", ta: "Customers", te: "Customers", gu: "Customers", pa: "Customers" };
  const scripts = { bn: /\p{Script=Bengali}/u, mr: /\p{Script=Devanagari}/u, ta: /\p{Script=Tamil}/u, te: /\p{Script=Telugu}/u, gu: /\p{Script=Gujarati}/u, pa: /\p{Script=Gurmukhi}/u };
  for (const [locale, key] of Object.entries(samples)) assert.match(localeDictionaries[locale][key], scripts[locale]);
});

test("Batch 2 locales contain genuine translations for the complete tracked inventory", () => {
  const required = [...new Set([...APP_STATIC_TRANSLATION_KEYS, ...APP_RUNTIME_TRANSLATION_KEYS])]
    .filter((key) => key !== "98XXXXXXXX");
  assert.equal(required.length, 428);
  for (const locale of ["bn", "mr", "ta", "te", "gu", "pa"]) {
    const dictionary = { ...localeDictionaries[locale], ...customerLifecycleTranslations[locale] };
    const missing = required.filter((key) => !dictionary[key]?.trim() || dictionary[key] === key);
    assert.deepEqual(missing, [], `${locale} must not rely on English fallback`);
  }
});

test("Batch 3 locales contain genuine translations for the complete tracked inventory", () => {
  const required = [...new Set([...APP_STATIC_TRANSLATION_KEYS, ...APP_RUNTIME_TRANSLATION_KEYS])]
    .filter((key) => key !== "98XXXXXXXX");
  const batch3Locales = ["kn", "ml", "or", "as", "ur", "ne"];
  assert.equal(required.length, 428);
  for (const locale of batch3Locales) {
    const dictionary = { ...localeDictionaries[locale], ...customerLifecycleTranslations[locale] };
    const missing = required.filter((key) =>
      !dictionary[key]?.trim() || dictionary[key] === key);
    assert.deepEqual(missing, [], `${locale} must not rely on English fallback`);
  }
});

test("Batch 3 translation groups have unique keys and use the expected scripts", () => {
  const groups = [
    BATCH3_GROUP1_KEYS, BATCH3_GROUP2_KEYS, BATCH3_GROUP3_KEYS, BATCH3_GROUP4_KEYS,
    BATCH3_GROUP5_KEYS, BATCH3_GROUP6_KEYS, BATCH3_GROUP7_KEYS,
  ];
  for (const keys of groups) assert.equal(new Set(keys).size, keys.length, "translation group has duplicate keys");
  const allBatch3Keys = groups.flat();
  assert.equal(new Set(allBatch3Keys).size, allBatch3Keys.length, "translation groups must not override one another");

  const samples = { kn: "Customers", ml: "Customers", or: "Customers", as: "Customers", ur: "Customers", ne: "Customers" };
  const scripts = {
    kn: /\p{Script=Kannada}/u,
    ml: /\p{Script=Malayalam}/u,
    or: /\p{Script=Oriya}/u,
    as: /\p{Script=Bengali}/u,
    ur: /\p{Script=Arabic}/u,
    ne: /\p{Script=Devanagari}/u,
  };
  for (const [locale, key] of Object.entries(samples))
    assert.match(localeDictionaries[locale][key], scripts[locale], `${locale} should use its native script`);
});

test("Batch 4 initial translation group is unique, placeholder-safe and uses the requested scripts", () => {
  const batch4Keys = [
    ...BATCH4_GROUP1_KEYS, ...BATCH4_GROUP2_KEYS, ...BATCH4_GROUP3_KEYS, ...BATCH4_GROUP4_KEYS,
    ...BATCH4_GROUP5_KEYS,
    ...BATCH4_GROUP6_KEYS,
    ...BATCH4_GROUP7_KEYS,
    ...BATCH4_GROUP8_KEYS,
    ...BATCH4_GROUP9_KEYS,
    ...BATCH4_GROUP10_KEYS,
    ...BATCH4_GROUP11_KEYS,
    ...BATCH4_GROUP12_KEYS,
    ...BATCH4_GROUP13_KEYS,
  ];
  assert.equal(new Set(batch4Keys).size, batch4Keys.length, "Batch 4 groups must not contain duplicate keys");
  const locales = ["mai", "sat", "ks", "kok", "sd", "doi", "mni", "brx", "sa"];
  for (const locale of locales) {
    for (const key of batch4Keys) {
      const value = localeDictionaries[locale]?.[key];
      assert.ok(value?.trim(), `${locale}:${key} is missing`);
      if (!["SMS", "WhatsApp"].includes(key))
        assert.notEqual(value, key, `${locale}:${key} must not use English fallback`);
    }
  }
  const placeholders = (text) => [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]).sort();
  for (const locale of locales) for (const key of batch4Keys)
    assert.deepEqual(placeholders(localeDictionaries[locale][key]), placeholders(key), `${locale}:${key} placeholders`);
  const scripts = {
    mai: /\p{Script=Devanagari}/u,
    sat: /\p{Script=Ol_Chiki}/u,
    ks: /\p{Script=Arabic}/u,
    kok: /\p{Script=Devanagari}/u,
    sd: /\p{Script=Arabic}/u,
    doi: /\p{Script=Devanagari}/u,
    mni: /\p{Script=Meetei_Mayek}/u,
    brx: /\p{Script=Devanagari}/u,
    sa: /\p{Script=Devanagari}/u,
  };
  for (const locale of locales) assert.match(localeDictionaries[locale].Customers, scripts[locale]);
});

test("all 23 locales cover the full 428-key inventory without relying on fallback", () => {
  const required = [...new Set([...APP_STATIC_TRANSLATION_KEYS, ...APP_RUNTIME_TRANSLATION_KEYS])]
    .filter((key) => key !== "98XXXXXXXX");
  assert.equal(required.length, 428);

  // Hindi's established dictionary is split between i18n.tsx and translations.ts.
  const hindi = { ...localeDictionaries.hi };
  const hindiAst = ts.createSourceFile("src/i18n.tsx", readFileSync("src/i18n.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function collectHindi(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(hindiAst) === "hindi" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)) {
          const key = property.name.getText(hindiAst).replace(/^['"]|['"]$/g, "");
          hindi[key] = property.initializer.text;
        }
      }
    }
    ts.forEachChild(node, collectHindi);
  }
  collectHindi(hindiAst);

  for (const locale of LOCALE_IDS) {
    const dictionary = locale === "en"
      ? Object.fromEntries(required.map((key) => [key, key]))
      : { ...(locale === "hi" ? hindi : localeDictionaries[locale]), ...(customerLifecycleTranslations[locale] || {}) };
    const unchanged = locale === "en" ? new Set(required) : new Set(["SMS", "WhatsApp"]);
    const coverage = measureTranslationCoverage(required, dictionary, locale, unchanged);
    assert.equal(coverage.translated, 428, `${locale} translated key count`);
    assert.deepEqual(coverage.missingKeys, [], `${locale} must not rely on English fallback`);
  }
});

test("API errors use stable-code translations and safe localized generic fallbacks", () => {
  assert.equal(
    apiErrorTranslationKey("CUSTOMER_MOBILE_ALREADY_EXISTS", 409),
    "A customer with this mobile number already exists in your shop. Please open the existing customer.",
  );
  assert.equal(
    apiErrorTranslationKey("CUSTOMER_LIMIT_REACHED", 409),
    "Customer limit reached",
  );
  assert.equal(apiErrorTranslationKey("UNKNOWN_PRIVATE_SERVER_DETAIL", 500), "Server unavailable");
  assert.equal(apiErrorTranslationKey(undefined, 409), "Could not sync changes");
  assert.equal(apiErrorTranslationKey(undefined, 400), "Invalid request");
  assert.equal(apiErrorTranslationKey(undefined, 403), "Access denied");
  assert.equal(apiErrorTranslationKey(undefined, 404), "Resource not found");
  assert.equal(apiErrorTranslationKey(undefined, 429), "Too many requests. Try again later.");

  const errorKeys = [
    apiErrorTranslationKey("CUSTOMER_MOBILE_ALREADY_EXISTS", 409),
    apiErrorTranslationKey("CUSTOMER_LIMIT_REACHED", 409),
    apiErrorTranslationKey("ACCOUNT_SHOP_LINK_CONFLICT", 409),
    apiErrorTranslationKey("SHOP_PHONE_ALREADY_REGISTERED", 409),
    apiErrorTranslationKey("ACCOUNT_PHONE_INVALID", 409),
    apiErrorTranslationKey("CHECKOUT_DISABLED", 503),
    apiErrorTranslationKey("UNRECOGNIZED", 500),
    "Invalid request", "Access denied", "Resource not found", "Too many requests. Try again later.",
  ];
  for (const locale of ["bn", "mr", "te", "ta", "gu", "ur", "kn", "ml", "or", "pa", "as", "ne", "mai", "sat", "ks", "kok", "sd", "doi", "mni", "brx", "sa"]) {
    for (const key of errorKeys) {
      assert.ok(localeDictionaries[locale][key]?.trim(), `${locale} missing API error translation: ${key}`);
      assert.notEqual(localeDictionaries[locale][key], key, `${locale} uses fallback for API error: ${key}`);
    }
  }

  const app = readFileSync("App.tsx", "utf8");
  assert.match(app, /apiErrorTranslationKey\(code, error\.status\)/);
  assert.doesNotMatch(app, /error instanceof api\.ApiError\s*\?\s*error\.message/);
  assert.match(app, /activeLanguageRef\.current, \.\.\.args/);
});

test("API diagnostics classify transport versus HTTP failures without logging request data", () => {
  const api = readFileSync("src/api.ts", "utf8");
  const app = readFileSync("App.tsx", "utf8");
  assert.match(api, /durationMs: Date\.now\(\) - startedAt/);
  assert.match(api, /responseReceived: details\.responseReceived/);
  assert.match(api, /origin,/);
  assert.match(api, /category: details\.category/);
  assert.match(api, /endpoint,/);
  assert.doesNotMatch(api.match(/const logFailure = \(details:[\s\S]*?\n  \};/)?.[0] || "", /body|authorization|token|phone|address/i);
  assert.doesNotMatch(app, /error instanceof TypeError/);
  assert.match(app, /error instanceof api\.ApiTransportError && error\.kind === "network"/);
});

test("translation coverage counts only real dictionary translations and exposes fallback keys", () => {
  const coverage = measureTranslationCoverage(
    ["Home", "SMS", "Customers", "Missing"],
    { Home: "Accueil", SMS: "SMS", Customers: "Customers" },
    "example",
    new Set(["SMS"]),
  );
  assert.deepEqual(coverage, {
    locale: "example",
    required: 4,
    translated: 2,
    missingKeys: ["Customers", "Missing"],
    fallbackCount: 2,
  });
});

function collectStaticUiStrings(file) {
  const source = readFileSync(file, "utf8");
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const keys = new Set();
  const add = (raw) => {
    const key = raw.trim().replace(/\s+/g, " ");
    if (key && /[A-Za-z]/.test(key) && !key.startsWith("#")) keys.add(key);
  };
  function visit(node) {
    if (ts.isJsxText(node)) add(node.text);
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) &&
        ["placeholder", "accessibilityLabel", "label", "title", "message"].includes(node.name.getText(ast)))
      add(node.initializer.text);
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(ast);
      if (name === "Alert.alert")
        for (const argument of node.arguments) if (ts.isStringLiteral(argument)) add(argument.text);
      if (["t", "translate", "showLocalizedAlert"].includes(name)) {
        const limit = name === "showLocalizedAlert" ? Math.min(3, node.arguments.length) : 1;
        for (const argument of node.arguments.slice(0, limit))
          if (ts.isStringLiteral(argument)) add(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return [...keys].sort();
}

test("static translation inventory stays in sync with the rendered app UI", () => {
  const sourceKeys = ["App.tsx", "src/ui.tsx", "src/ErrorBoundary.tsx"]
    .flatMap(collectStaticUiStrings);
  assert.deepEqual([...new Set(sourceKeys)].sort(), [...APP_STATIC_TRANSLATION_KEYS].sort());
});

test("Hindi covers every translatable static UI key; only a numeric phone placeholder is exempt", () => {
  const normalize = (key) => key.trim().replace(/\s+/g, " ");
  const getObjectKeys = (file, variableName) => {
    const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const keys = new Set();
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === variableName &&
          node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        for (const property of node.initializer.properties)
          if (ts.isPropertyAssignment(property)) keys.add(normalize(property.name.getText(ast).replace(/^"|"$/g, "")));
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    return keys;
  };
  const translated = new Set([
    ...getObjectKeys("src/i18n.tsx", "hindi"),
    ...Object.keys(localeDictionaries.hi).map(normalize),
    ...Object.keys(customerLifecycleTranslations.hi || {}).map(normalize),
  ]);
  const nonlinguistic = new Set(["98XXXXXXXX"]);
  const missing = APP_STATIC_TRANSLATION_KEYS
    .map(normalize)
    .filter((key) => !translated.has(key) && !nonlinguistic.has(key));
  assert.deepEqual(missing, []);
});

test("Hindi covers every inventoried runtime-generated UI phrase", () => {
  const hindi = { ...localeDictionaries.hi, ...(customerLifecycleTranslations.hi || {}) };
  for (const key of APP_RUNTIME_TRANSLATION_KEYS) {
    assert.ok(hindi[key]?.trim(), `hi runtime phrase is missing: ${key}`);
  }
});

test("translated entries preserve interpolation placeholders", () => {
  const placeholders = (text) => [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)]
    .map((match) => match[1]).sort();
  for (const [locale, dictionary] of Object.entries(localeDictionaries)) {
    for (const [source, translated] of Object.entries(dictionary)) {
      assert.deepEqual(
        placeholders(translated),
        placeholders(source),
        `${locale}:${source} must preserve interpolation placeholders`,
      );
    }
  }
});

test("switching locale selects the corresponding translated value immediately", () => {
  const source = "Customers";
  assert.equal(resolveLocaleText(source, localeDictionaries.hi), "ग्राहक");
  assert.equal(resolveLocaleText(source, localeDictionaries.bn), "গ্রাহক");
  assert.equal(resolveLocaleText(source, localeDictionaries.ta), "வாடிக்கையாளர்கள்");
  assert.equal(resolveLocaleText(source, localeDictionaries.ur), "گاہک");
  assert.equal(resolveLocaleText(source, {}), source);
  assert.equal(
    resolveLocaleText("{{count}} customers", localeDictionaries.bn).replace("{{count}}", "2"),
    "2 জন গ্রাহক",
  );
});

test("an API error arriving after a language change uses the currently selected locale", () => {
  const key = apiErrorTranslationKey("CUSTOMER_MOBILE_ALREADY_EXISTS", 409);
  const expected = new Map([
    ["en", "A customer with this mobile number already exists in your shop. Please open the existing customer."],
    ["hi", "इस मोबाइल नंबर का ग्राहक आपकी दुकान में पहले से मौजूद है। कृपया उसी ग्राहक का विवरण खोलें।"],
    ["bn", "এই মোবাইল নম্বরের একজন গ্রাহক আপনার দোকানে আছেন। অনুগ্রহ করে সেই গ্রাহকের তথ্য খুলুন।"],
    ["ta", "இந்த கைபேசி எண்ணைக் கொண்ட வாடிக்கையாளர் உங்கள் கடையில் ஏற்கனவே உள்ளார். அவருடைய பதிவைத் திறக்கவும்."],
    ["ur", "اس موبائل نمبر کا گاہک آپ کی دکان میں پہلے سے موجود ہے۔ براہ کرم اسی گاہک کو کھولیں۔"],
  ]);
  // Resolve at alert time, after the selected language may have changed while the request was pending.
  for (const [locale, value] of expected) {
    const rendered = locale === "en" ? key : resolveLocaleText(key, localeDictionaries[locale]);
    assert.equal(rendered, value);
  }
  const app = readFileSync("App.tsx", "utf8");
  assert.match(app, /apiErrorTranslationKey\(code, error\.status\)/);
});

test("app-mounted copy reads the active language and delayed alerts use the latest selection", () => {
  const app = readFileSync("App.tsx", "utf8");
  const i18n = readFileSync("src/i18n.tsx", "utf8");
  assert.match(app, /LanguageContext\.Provider value=\{data\.language\}/);
  assert.match(i18n, /const language = useContext\(LanguageContext\)/);
  assert.match(app, /showLocalizedAlert\(activeLanguageRef\.current, \.\.\.args\)/);
  assert.match(app, /languagePreferenceRevision\.current !== revisionAtRead/);
  assert.match(app, /languageChosenRef\.current\)\s*remote = \{ \.\.\.remote, language: activeLanguageRef\.current \}/);
  const preference = readFileSync("src/languagePreference.ts", "utf8");
  assert.match(preference, /getItemAsync\(LANGUAGE_KEY\)/);
  assert.match(preference, /setItemAsync\(LANGUAGE_KEY, id\)/);
});

test("interpolation and plural categories retain supplied values", () => {
  assert.equal(interpolate("{{count}} changes for {{shop}}", { count: 2, shop: "A" }), "2 changes for A");
  assert.equal(pluralTemplate("en", 1, { one: "{{count}} customer", other: "{{count}} customers" }), "1 customer");
  assert.equal(pluralTemplate("en", 3, { one: "{{count}} customer", other: "{{count}} customers" }), "3 customers");
});

test("runtime-generated UI phrases match localized templates without translating user values", () => {
  assert.equal(
    resolveLocaleText("Remaining advance: ₹700", { "Remaining advance: {{amount}}": "शेष अग्रिम: {{amount}}" }),
    "शेष अग्रिम: ₹700",
  );
  assert.equal(
    resolveLocaleText("Open WhatsApp", { "Open {{channel}}": "{{channel}} खोलें" }),
    "WhatsApp खोलें",
  );
  assert.equal(
    resolveLocaleText("Remaining advance: $&", { "Remaining advance: {{amount}}": "शेष अग्रिम: {{amount}}" }),
    "शेष अग्रिम: $&",
  );
  assert.equal(resolveLocaleText("A user-entered note", { "Remaining advance: {{amount}}": "शेष अग्रिम: {{amount}}" }), "A user-entered note");
});

test("currency and date formatting use the selected Indian locale without changing the amount", () => {
  const formatted = formatCurrency(125000, "en");
  assert.match(formatted, /₹/);
  assert.match(formatted, /1,25,000/);
  assert.match(formatCurrency(1500, "hi"), /₹/);
  assert.ok(formatLocaleDate(new Date("2026-10-15T12:00:00Z"), "bn").length > 0);
  for (const locale of LOCALES) {
    assert.match(formatCurrency(1500, locale.id), /₹/);
    assert.ok(formatLocaleDate(new Date("2026-10-15T12:00:00Z"), locale.id).length > 0);
  }
});

test("right-to-left locale metadata is limited to Arabic-script languages", () => {
  assert.equal(localeDirection("ur"), "rtl");
  assert.equal(localeDirection("sd"), "rtl");
  assert.equal(localeDirection("ks"), "rtl");
  assert.equal(localeDirection("hi"), "ltr");
});
