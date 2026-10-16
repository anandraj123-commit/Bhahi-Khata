import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { subscriptionConfig } from "../config/env.js";
import { error } from "../utils/http.js";
import {
  createSubscriptionOrder,
  getCurrentSubscription,
  getPaymentOrderStatus,
  getSubscriptionHistory,
  getSubscriptionUsage,
  listPaymentHistory,
  listSubscriptionPlans,
  processPaymentWebhook,
  verifyPayment,
} from "../services/subscriptionService.js";

const purchaseSchema = z.object({
  planCode: z.enum(["pro", "business"]),
  durationMonths: z.number().int().min(1).max(36),
}).strict();

function serviceFailure(res, next, e) {
  if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 600)
    return error(res, e.status, e.message);
  return next(e);
}

export async function handle_get_subscription_plans(req, res, next) {
  try { res.json(await listSubscriptionPlans()); } catch (e) { next(e); }
}

export async function handle_get_subscription_current(req, res, next) {
  try { res.json(await getCurrentSubscription(req.shopId)); } catch (e) { next(e); }
}

export async function handle_get_subscription_history(req, res, next) {
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
    res.json(await getSubscriptionHistory({ shopId: req.shopId, limit, cursor: String(req.query.cursor || "") }));
  } catch (e) { next(e); }
}

export async function handle_get_subscription_usage(req, res, next) {
  try { res.json(await getSubscriptionUsage(req.shopId)); } catch (e) { next(e); }
}

export async function handle_get_subscription_payments(req, res, next) {
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
    res.json(await listPaymentHistory({ shopId: req.shopId, limit, cursor: String(req.query.cursor || "") }));
  } catch (e) { next(e); }
}

async function createOrder(req, res, next) {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) return error(res, 400, "Invalid subscription purchase");
  try {
    const result = await createSubscriptionOrder({
      shopId: req.shopId,
      userId: req.user._id,
      planCode: parsed.data.planCode,
      months: parsed.data.durationMonths,
      idempotencyKey: String(req.headers["idempotency-key"] || ""),
    });
    res.status(201).json({
      orderId: String(result.order._id),
      gatewayOrderId: result.order.gatewayOrderId,
      keyId: result.keyId,
      amountMinor: result.order.amountMinor,
      currency: result.order.currency,
      pricing: result.order.pricingSnapshot,
      status: result.order.status,
    });
  } catch (e) { serviceFailure(res, next, e); }
}

export const handle_post_subscription_checkout = createOrder;
export const handle_post_subscription_renew = createOrder;
export const handle_post_subscription_change_plan = createOrder;

export async function handle_post_payment_verify(req, res, next) {
  const parsed = z.object({
    orderId: z.string().regex(/^[a-f\d]{24}$/i),
    paymentId: z.string().min(1).max(120),
    signature: z.string().regex(/^[a-f\d]{64}$/i),
  }).strict().safeParse(req.body);
  if (!parsed.success) return error(res, 400, "Invalid payment verification request");
  try {
    res.json(await verifyPayment({ shopId: req.shopId, userId: req.user._id, ...parsed.data }));
  } catch (e) { serviceFailure(res, next, e); }
}

export async function handle_get_payment_status(req, res, next) {
  try { res.json(await getPaymentOrderStatus({ shopId: req.shopId, orderId: req.params.orderId })); }
  catch (e) { serviceFailure(res, next, e); }
}

export async function handle_post_payment_webhook(req, res, next) {
  try {
    if (!Buffer.isBuffer(req.body)) return error(res, 400, "Invalid webhook body");
    const signature = String(req.headers["x-razorpay-signature"] || "");
    const eventId = String(req.headers["x-razorpay-event-id"] || "");
    if (!subscriptionConfig.razorpayWebhookSecret || !eventId || eventId.length > 200 || !/^[a-f\d]{64}$/i.test(signature))
      return error(res, 400, "Invalid webhook signature");
    const expected = createHmac("sha256", subscriptionConfig.razorpayWebhookSecret).update(req.body).digest();
    const provided = Buffer.from(signature, "hex");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
      return error(res, 400, "Invalid webhook signature");
    const event = JSON.parse(req.body.toString("utf8"));
    const eventType = String(event.event || "");
    const payment = event.payload?.payment?.entity;
    if (!payment || !["payment.captured", "payment.failed", "payment.refunded", "refund.processed"].includes(eventType))
      return res.status(200).json({ received: true, ignored: true });
    await processPaymentWebhook({ eventId, eventType, payment });
    res.status(200).json({ received: true });
  } catch (e) {
    if (e instanceof SyntaxError) return error(res, 400, "Invalid webhook body");
    serviceFailure(res, next, e);
  }
}
