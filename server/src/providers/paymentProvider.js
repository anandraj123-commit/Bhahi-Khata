import { subscriptionConfig } from "../config/env.js";
import * as cashfree from "./cashfree.js";

// Provider selection stays behind this boundary so a future eligible app
// distribution can add a compliant billing provider without changing services.
export function paymentProvider({ forVerification = false } = {}) {
  if (!subscriptionConfig.checkoutEnabled && !forVerification)
    throw Object.assign(new Error("Online checkout is not enabled for this app distribution"), {
      status: 503,
      code: "CHECKOUT_DISABLED",
    });
  if (!subscriptionConfig.cashfreeClientId || !subscriptionConfig.cashfreeClientSecret)
    throw Object.assign(new Error("Payment provider credentials are unavailable"), { status: 503 });
  return {
    name: "cashfree",
    createOrder: cashfree.createCashfreeOrder,
    fetchOrder: cashfree.fetchCashfreeOrder,
    fetchPayment: cashfree.fetchCashfreePayment,
    fetchOrderPayments: cashfree.fetchCashfreeOrderPayments,
  };
}
