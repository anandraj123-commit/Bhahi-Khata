import { subscriptionConfig } from "../config/env.js";

const authorization = () =>
  `Basic ${Buffer.from(`${subscriptionConfig.razorpayKeyId}:${subscriptionConfig.razorpayKeySecret}`).toString("base64")}`;

export async function createRazorpayOrder({ amountMinor, currency, receipt, notes }) {
  let response;
  try {
    response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: authorization(), "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountMinor, currency, receipt, notes }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Object.assign(new Error("Payment provider is unavailable"), { status: 503 });
  }
  const value = await response.json().catch(() => null);
  if (!response.ok || !value?.id || value.amount !== amountMinor || value.currency !== currency)
    throw Object.assign(new Error("Payment order could not be created"), { status: 502 });
  return { id: value.id, amount: value.amount, currency: value.currency };
}

export async function fetchRazorpayPayment(paymentId) {
  let response;
  try {
    response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: authorization() },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Object.assign(new Error("Payment provider is unavailable"), { status: 503 });
  }
  const value = await response.json().catch(() => null);
  if (!response.ok || !value?.id)
    throw Object.assign(new Error("Payment could not be verified"), { status: 502 });
  return value;
}

export async function fetchRazorpayOrderPayments(orderId) {
  let response;
  try {
    response = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}/payments`, {
      headers: { Authorization: authorization() },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Object.assign(new Error("Payment provider is unavailable"), { status: 503 });
  }
  const value = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(value?.items))
    throw Object.assign(new Error("Payment status could not be reconciled"), { status: 502 });
  return value.items;
}
