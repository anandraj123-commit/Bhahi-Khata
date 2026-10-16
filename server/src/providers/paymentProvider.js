import { subscriptionConfig } from "../config/env.js";
import * as razorpay from "./razorpay.js";

// Provider selection stays behind this boundary so a future eligible app
// distribution can add a compliant billing provider without changing services.
export function paymentProvider({ forVerification = false } = {}) {
  if (!subscriptionConfig.checkoutEnabled && !forVerification)
    throw Object.assign(new Error("Online checkout is not enabled for this app distribution"), {
      status: 503,
      code: "CHECKOUT_DISABLED",
    });
  if (!subscriptionConfig.razorpayKeyId || !subscriptionConfig.razorpayKeySecret)
    throw Object.assign(new Error("Payment provider credentials are unavailable"), { status: 503 });
  return {
    name: "razorpay",
    createOrder: razorpay.createRazorpayOrder,
    fetchPayment: razorpay.fetchRazorpayPayment,
    fetchOrderPayments: razorpay.fetchRazorpayOrderPayments,
  };
}
