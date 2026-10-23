import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";

Object.assign(process.env, {
  NODE_ENV: "test",
  APP_MODE: "testing",
  MONGODB_URI: "mongodb://127.0.0.1:27028/?replicaSet=dkAdminTest",
  MONGODB_DB_NAME: "digital_khata_testing",
  JWT_SECRET: "cashfree-unit-test-secret-value-long-enough",
  CASHFREE_ENVIRONMENT: "sandbox",
  CASHFREE_API_VERSION: "2026-01-01",
  CASHFREE_CHECKOUT_ENABLED: "false",
  CASHFREE_WEBHOOK_SECRET: "webhook-unit-test-secret",
});

let cashfree;
let createApp;
const originalFetch = globalThis.fetch;

before(async () => {
  cashfree = await import("./cashfree.js");
  ({ createApp } = await import("../app.js"));
});

after(() => { globalThis.fetch = originalFetch; });

test("Cashfree amount conversion accepts paise-safe amounts only", () => {
  assert.equal(cashfree.cashfreeAmountMinor(199), 19900);
  assert.equal(cashfree.cashfreeAmountMinor(0.01), 1);
  assert.equal(cashfree.cashfreeAmountMinor(1.001), null);
  assert.equal(cashfree.cashfreeAmountMinor("199"), null);
  assert.equal(cashfree.cashfreeAmountMinor(-1), null);
});

test("Cashfree order creation sends only the server-quoted amount and validates response", async () => {
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url: String(url), options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      order_id: "dk_order_1",
      cf_order_id: 123,
      payment_session_id: "session-value",
      order_amount: 199,
      order_currency: "INR",
      order_status: "ACTIVE",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const order = await cashfree.createCashfreeOrder({
    orderId: "dk_order_1",
    amountMinor: 19900,
    currency: "INR",
    customerId: "shop_123",
    customerPhone: "9876543210",
    idempotencyKey: "stable-test-key",
  });
  assert.equal(sent.url, "https://sandbox.cashfree.com/pg/orders");
  assert.equal(sent.body.order_amount, 199);
  assert.equal(sent.body.order_currency, "INR");
  assert.equal(sent.options.headers["x-idempotency-key"], "stable-test-key");
  assert.equal(order.paymentSessionId, "session-value");

  globalThis.fetch = async () => new Response(JSON.stringify({
    order_id: "a-different-order",
    payment_session_id: "session-value",
    order_amount: 199,
    order_currency: "INR",
  }), { status: 200 });
  await assert.rejects(
    cashfree.createCashfreeOrder({ orderId: "dk_order_1", amountMinor: 19900, currency: "INR", customerId: "shop_123", customerPhone: "9876543210", idempotencyKey: "stable-test-key" }),
    { code: "CASHFREE_INVALID_ORDER" },
  );
});

test("Cashfree webhook route rejects invalid signatures before payment processing", async () => {
  globalThis.fetch = originalFetch;
  const server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/payments/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-timestamp": String(Date.now()), "x-webhook-signature": "invalid" },
      body: JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK" }),
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
