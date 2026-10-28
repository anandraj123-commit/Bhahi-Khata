import { subscriptionConfig } from "../config/env.js";

const baseUrl = () => subscriptionConfig.cashfreeEnvironment === "production"
  ? "https://api.cashfree.com/pg"
  : "https://sandbox.cashfree.com/pg";

function headers(idempotencyKey) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-client-id": subscriptionConfig.cashfreeClientId,
    "x-client-secret": subscriptionConfig.cashfreeClientSecret,
    "x-api-version": subscriptionConfig.cashfreeApiVersion,
    ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
  };
}

async function cashfreeRequest(path, { method = "GET", body, idempotencyKey } = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: headers(idempotencyKey),
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Object.assign(new Error("Payment provider is unavailable"), { status: 503, code: "PAYMENT_PROVIDER_UNAVAILABLE" });
  }
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error("Payment provider request failed"), {
      status: response.status === 429 ? 503 : 502,
      code: "CASHFREE_REQUEST_FAILED",
    });
  }
  return value;
}

export async function createCashfreeOrder({
  orderId,
  amountMinor,
  currency,
  customerId,
  customerPhone,
  customerName,
  idempotencyKey,
}) {
  const amount = amountMinor / 100;
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 100 || !Number.isFinite(amount))
    throw Object.assign(new Error("Payment amount is invalid"), { status: 400, code: "INVALID_PAYMENT_AMOUNT" });
  const value = await cashfreeRequest("/orders", {
    method: "POST",
    idempotencyKey,
    body: {
      order_id: orderId,
      order_amount: amount,
      order_currency: currency,
      customer_details: {
        customer_id: customerId,
        customer_phone: customerPhone,
        ...(customerName ? { customer_name: customerName } : {}),
      },
      ...(subscriptionConfig.cashfreeWebhookUrl
        ? { order_meta: { notify_url: subscriptionConfig.cashfreeWebhookUrl } }
        : {}),
      order_note: "Digital Khata subscription",
    },
  });
  const responseAmountMinor = Number.isFinite(value?.order_amount)
    ? Math.round(value.order_amount * 100)
    : null;
  if (
    value?.order_id !== orderId ||
    !value?.payment_session_id ||
    responseAmountMinor !== amountMinor ||
    value?.order_currency !== currency
  )
    throw Object.assign(new Error("Payment order could not be validated"), { status: 502, code: "CASHFREE_INVALID_ORDER" });
  return {
    id: value.order_id,
    cfOrderId: String(value.cf_order_id || ""),
    paymentSessionId: value.payment_session_id,
    amountMinor: responseAmountMinor,
    currency: value.order_currency,
    status: value.order_status,
    expiresAt: value.order_expiry_time ? new Date(value.order_expiry_time) : null,
  };
}

export async function fetchCashfreeOrder(orderId) {
  const value = await cashfreeRequest(`/orders/${encodeURIComponent(orderId)}`);
  if (value?.order_id !== orderId)
    throw Object.assign(new Error("Payment order could not be verified"), { status: 502, code: "CASHFREE_ORDER_MISMATCH" });
  return value;
}

export async function fetchCashfreeOrderPayments(orderId) {
  const value = await cashfreeRequest(`/orders/${encodeURIComponent(orderId)}/payments`);
  if (!Array.isArray(value))
    throw Object.assign(new Error("Payment status could not be verified"), { status: 502, code: "CASHFREE_INVALID_PAYMENTS" });
  return value;
}

export async function fetchCashfreePayment({ orderId, paymentId }) {
  const value = await cashfreeRequest(
    `/orders/${encodeURIComponent(orderId)}/payments/${encodeURIComponent(paymentId)}`,
  );
  if (String(value?.cf_payment_id || "") !== String(paymentId))
    throw Object.assign(new Error("Payment could not be verified"), { status: 502, code: "CASHFREE_PAYMENT_MISMATCH" });
  return value;
}

export function cashfreeAmountMinor(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const paise = Math.round(value * 100);
  return Number.isSafeInteger(paise) && Math.abs(value * 100 - paise) < 0.000001 ? paise : null;
}
