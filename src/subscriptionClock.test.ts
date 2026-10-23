import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateOfflineSubscriptionClock,
  isOfflineEntitlementUsable,
  mergeVerifiedSubscriptionClockAnchor,
} from "./subscriptionClock.ts";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

test("offline subscription clock catches a handset date moved backwards after verification", () => {
  const anchor = { shopId: "shop-a", observedAt: 2_000_000 };
  assert.equal(evaluateOfflineSubscriptionClock({ now: 1_000_000, shopId: "shop-a", anchor }).safe, false);
  assert.equal(evaluateOfflineSubscriptionClock({ now: 2_000_001, shopId: "shop-a", anchor }).safe, true);
});

test("offline entitlement clock is bound to the shop and refuses a missing time anchor", () => {
  assert.equal(evaluateOfflineSubscriptionClock({ now: 2_000_000, shopId: "shop-b", anchor: { shopId: "shop-a", observedAt: 1_000_000 } }).safe, false);
  assert.equal(evaluateOfflineSubscriptionClock({ now: 2_000_000, shopId: "shop-a", anchor: null }).safe, false);
  assert.equal(evaluateOfflineSubscriptionClock({ now: 2_000_000, shopId: "shop-a", anchor: null, cachedAt: 1_000_000 }).safe, true);
});

test("verified clock anchors never move backwards for the same shop", () => {
  assert.deepEqual(
    mergeVerifiedSubscriptionClockAnchor({ shopId: "shop-a", observedAt: 2_000_000 }, "shop-a", 1_000_000),
    { shopId: "shop-a", observedAt: 2_000_000 },
  );
  assert.deepEqual(
    mergeVerifiedSubscriptionClockAnchor({ shopId: "shop-a", observedAt: 2_000_000 }, "shop-b", 1_000_000),
    { shopId: "shop-b", observedAt: 1_000_000 },
  );
});

test("forward date changes can expire an entitlement but never make a backwards clock usable", () => {
  const expiry = 3_000_000;
  assert.equal(isOfflineEntitlementUsable({ now: expiry - 1, expiresAt: expiry, clockSafe: true }), true);
  assert.equal(isOfflineEntitlementUsable({ now: expiry, expiresAt: expiry, clockSafe: true }), false);
  assert.equal(isOfflineEntitlementUsable({ now: expiry - 1, expiresAt: Number.NaN, clockSafe: true }), false);
  assert.equal(isOfflineEntitlementUsable({ now: expiry - 1, expiresAt: expiry, clockSafe: false }), false);
  // Time zone changes do not alter epoch milliseconds; policy uses absolute timestamps.
  assert.equal(isOfflineEntitlementUsable({ now: 2_000_000, expiresAt: expiry, clockSafe: true }), true);
});

test("Cashfree webhook route requires a valid signature over the exact raw timestamp and body", async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_MODE: "testing",
    MONGODB_URI: "mongodb://127.0.0.1:27028/?replicaSet=dkAdminTest",
    MONGODB_DB_NAME: "digital_khata_testing",
    JWT_SECRET: "cashfree-webhook-test-secret-long-enough",
    CASHFREE_ENVIRONMENT: "sandbox",
    CASHFREE_API_VERSION: "2026-01-01",
    CASHFREE_CHECKOUT_ENABLED: "false",
    CASHFREE_WEBHOOK_SECRET: "isolated-webhook-test-secret",
  });
  const { createApp } = await import("../server/src/app.js");
  const server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/v1/payments/webhook`;
    const timestamp = String(Date.now());
    const raw = '{ "type": "PAYMENT_SUCCESS_WEBHOOK" }';
    const signature = createHmac("sha256", "isolated-webhook-test-secret")
      .update(timestamp)
      .update(raw)
      .digest("base64");

    const missing = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: raw });
    assert.equal(missing.status, 400);
    const valid = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-timestamp": timestamp, "x-webhook-signature": signature },
      body: raw,
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { received: true, ignored: true });
    const modified = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-timestamp": timestamp, "x-webhook-signature": signature },
      body: raw.replace("SUCCESS", "FAILED"),
    });
    assert.equal(modified.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
