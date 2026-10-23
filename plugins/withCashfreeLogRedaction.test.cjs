const assert = require("node:assert/strict");
const { test } = require("node:test");
const { enableReleaseShrinking, PROGUARD_RULES } = require("./withCashfreeLogRedaction.js");

test("release build enables R8 so Cashfree checkout-session debug logs are removed", () => {
  const gradle = [
    "android {",
    "  buildTypes {",
    "    debug { minifyEnabled false }",
    "    release { minifyEnabled enableProguardInReleaseBuilds }",
    "  }",
    "}",
  ].join("\n");
  const updated = enableReleaseShrinking(gradle);
  assert.match(updated, /debug \{ minifyEnabled false \}/);
  assert.match(updated, /release \{ minifyEnabled true \}/);
  assert.match(PROGUARD_RULES, /assumenosideeffects class android\.util\.Log/);
  assert.match(PROGUARD_RULES, /public static int d\(java\.lang\.String, java\.lang\.String\)/);
  assert.throws(() => enableReleaseShrinking("android { buildTypes { release { } } }"));
});
