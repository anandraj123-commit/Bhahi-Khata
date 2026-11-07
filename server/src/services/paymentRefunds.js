import mongoose from "mongoose";
import { PaymentOrder, PaymentRefund, PaymentTransaction } from "../models.js";
import { paymentProvider } from "../providers/paymentProvider.js";
import { cashfreeAmountMinor } from "../providers/cashfree.js";
import { subscriptionConfig } from "../config/env.js";

const invalid = () => Object.assign(new Error("Refund requires authoritative reconciliation review"),
  { status: 503, code: "REFUND_REVIEW_REQUIRED" });

export function verifiedRefundRecord(order, refund) {
  const amountMinor = cashfreeAmountMinor(refund?.refund_amount);
  if (!refund?.cf_refund_id || !refund.cf_payment_id || !refund.refund_id ||
      refund.order_id !== order.gatewayOrderId || refund.refund_currency !== order.currency ||
      !amountMinor || amountMinor > order.amountMinor ||
      !["SUCCESS", "PENDING", "CANCELLED", "ONHOLD", "FAILED"].includes(refund.refund_status)) throw invalid();
  return { appMode: order.appMode, shopId: order.shopId, orderId: order._id,
    gatewayOrderId: order.gatewayOrderId, gatewayPaymentId: String(refund.cf_payment_id),
    gatewayRefundId: String(refund.cf_refund_id), refundId: String(refund.refund_id),
    amountMinor, currency: order.currency, gatewayStatus: refund.refund_status, verifiedAt: new Date(),
    entitlementReviewRequired: true };
}

// Observation only: no refund submission, wallet credit or entitlement revocation.
export async function reconcileOrderRefunds(order) {
  const remote = await paymentProvider({ forVerification: true }).fetchRefunds(order.gatewayOrderId);
  const records = remote.map(refund => verifiedRefundRecord(order, refund));
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Serialize concurrent polls so the successful-refund total cannot race.
      const locked = await PaymentOrder.updateOne({ _id: order._id, appMode: order.appMode },
        { $set: { refundReconciliationCheckedAt: new Date() }, $unset: { refundReconciliationLastCode: 1 } }, { session });
      if (!locked.matchedCount) throw invalid();
      for (const record of records) {
        const key = { appMode: order.appMode, gatewayRefundId: record.gatewayRefundId };
        const prior = await PaymentRefund.findOne(key).session(session);
        if (prior && (String(prior.orderId) !== String(order._id) || prior.gatewayPaymentId !== record.gatewayPaymentId ||
            prior.amountMinor !== record.amountMinor || prior.currency !== record.currency)) throw invalid();
        if (prior?.gatewayStatus === "SUCCESS" && record.gatewayStatus !== "SUCCESS") continue;
        await PaymentRefund.updateOne(key, { $set: record }, { upsert: true, session });
      }
      const successful = await PaymentRefund.find({ orderId: order._id, gatewayStatus: "SUCCESS" }).session(session);
      for (const paymentId of new Set(successful.map(refund => refund.gatewayPaymentId))) {
        const refunds = successful.filter(refund => refund.gatewayPaymentId === paymentId);
        const total = refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
        const payment = await PaymentTransaction.findOne({ orderId: order._id, gatewayPaymentId: paymentId,
          verificationStatus: "verified", status: { $in: ["captured", "refunded", "partially_refunded"] } }).session(session);
        if (!payment) {
          await PaymentOrder.updateOne({ _id: order._id }, { $set: { refundReconciliationLastCode: "REFUND_CAPTURE_REVIEW_REQUIRED" } }, { session });
          continue; // Preserve the genuine verified refund; never invent a capture.
        }
        if (!Number.isSafeInteger(total) || total > payment.amountMinor) throw invalid();
        // Preserve the verified capture independently from the refund lifecycle.
        await PaymentTransaction.updateOne({ _id: payment._id }, {
          $max: { refundedAmountMinor: total },
          $addToSet: { refundReferences: { $each: refunds.map(refund => refund.gatewayRefundId) } },
        }, { session });
      }
    });
  } finally { await session.endSession(); }
  return records;
}

export async function reconcileRefundBacklog({ limit = 20, now = new Date() } = {}) {
  const orders = await PaymentOrder.find({ appMode: subscriptionConfig.appMode,
    gatewayOrderId: { $exists: true }, amountMinor: { $gt: 0 },
    $or: [{ refundReconciliationCheckedAt: { $exists: false } },
      { refundReconciliationCheckedAt: { $lte: new Date(now.getTime() - 3600_000) } }],
  }).sort({ refundReconciliationCheckedAt: 1, _id: 1 }).limit(limit).lean();
  for (const order of orders) {
    try { await reconcileOrderRefunds(order); }
    catch {
      await PaymentOrder.updateOne({ _id: order._id }, { $set: {
        refundReconciliationLastCode: "REFUND_REVIEW_REQUIRED", refundReconciliationCheckedAt: now,
      } });
    }
  }
  return { attempted: orders.length };
}
