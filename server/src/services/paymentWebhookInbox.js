import { reconcileOrderRefunds } from "./paymentRefunds.js";
import { PaymentWebhookEvent, PaymentOrder } from "../models.js";
import { subscriptionConfig } from "../config/env.js";
import { processPaymentWebhook } from "./subscriptionService.js";

// Only authenticated callers may enqueue. Store references, never webhook PII
// or asserted financial facts; processing re-fetches Cashfree with server keys.
export async function acceptPaymentWebhook(event, {
  events = PaymentWebhookEvent, process = processInboxEvent,
  appMode = subscriptionConfig.appMode, now = new Date(),
} = {}) {
  await events.updateOne({ eventId: event.eventId }, { $setOnInsert: {
    ...event, appMode, status: "received", nextAttemptAt: now,
  } }, { upsert: true, writeConcern: { w: "majority" } });
  return deliver(event, { events, process, now });
}

async function deliver(event, { events, process, now }) {
  try {
    await process(event);
    // A stale failure event can legitimately become obsolete after a verified
    // success. Persist this disposition before acknowledging it.
    const completed = await events.updateOne({ eventId: event.eventId }, {
      $set: { status: "processed", processedAt: now },
      $unset: { nextAttemptAt: 1, lastErrorCode: 1 },
    }, { writeConcern: { w: "majority" } });
    if (completed.matchedCount !== 1) throw new Error("Webhook completion record unavailable");
    return { received: true, queued: false };
  } catch (error) {
    const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code : "PAYMENT_WEBHOOK_RETRY_REQUIRED";
    // A DB failure here propagates (non-2xx). Never acknowledge a failed durable
    // write, nor let a delayed failure overwrite another processor's commit.
    const retained = await events.updateOne({ eventId: event.eventId, status: { $ne: "processed" } }, {
      $set: { status: "failed", lastErrorCode: code, nextAttemptAt: new Date(now.getTime() + 300_000) },
      $inc: { attempts: 1 },
    }, { writeConcern: { w: "majority" } });
    if (retained.matchedCount !== 1) {
      const committed = await events.findOne({ eventId: event.eventId, status: "processed" }).lean();
      if (committed) return { received: true, queued: false };
      throw Object.assign(new Error("Webhook recovery record unavailable"), { status: 503, code: "PAYMENT_WEBHOOK_PERSISTENCE_FAILED" });
    }
    return { received: true, queued: true };
  }
}

export async function retryPaymentWebhooks({ limit = 20, now = new Date() } = {}) {
  const events = await PaymentWebhookEvent.find({ appMode: subscriptionConfig.appMode,
    status: { $in: ["received", "failed"] }, nextAttemptAt: { $lte: now },
  }).sort({ nextAttemptAt: 1, _id: 1 }).limit(Math.min(50, Math.max(1, limit))).lean();
  let queued = 0;
  for (const event of events) {
    const result = await deliver({ eventId: event.eventId,
    eventType: event.eventType, orderId: event.orderId, paymentId: event.paymentId, refundId: event.refundId,
  }, { events: PaymentWebhookEvent, process: processInboxEvent, now });
    if (result.queued) queued += 1;
  }
  return { attempted: events.length, queued };
}

async function processInboxEvent(event) {
  if (["PAYMENT_SUCCESS_WEBHOOK", "PAYMENT_FAILED_WEBHOOK", "PAYMENT_USER_DROPPED_WEBHOOK"].includes(event.eventType))
    return processPaymentWebhook(event);
  if (event.eventType === "REFUND_STATUS_WEBHOOK") {
    const order = await PaymentOrder.findOne({ gatewayOrderId: event.orderId, appMode: subscriptionConfig.appMode }).lean();
    if (order && event.refundId) {
      const records = await reconcileOrderRefunds(order);
      if (records.some(record => record.refundId === event.refundId)) return;
    }
  }
  // Unknown/dispute lifecycle changes remain visible, never interpreted as paid
  // or discarded. Resolve provider API/policy support before automating them.
  throw Object.assign(new Error("Payment lifecycle event requires review"), { code: "PAYMENT_LIFECYCLE_REVIEW_REQUIRED" });
}
