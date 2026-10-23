import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { subscriptionConfig } from "../config/env.js";
import { error } from "../utils/http.js";
import {
  createSubscriptionOrder,
  getCurrentSubscription,
  getPaymentOrderStatus,
  getPaymentAttemptStatus,
  getSubscriptionHistory,
  getSubscriptionUsage,
  listPaymentHistory,
  listSubscriptionPlans,
  processPaymentWebhook,
  verifyPayment,
} from "../services/subscriptionService.js";

const purchaseSchema = z.object({
  planCode: z.enum(["pro", "business"]),
  durationMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  acceptedPricingVersion: z.number().int().positive().safe().optional(),
}).strict();

function serviceFailure(res, next, e) {
  if (e?.code === "SUBSCRIPTION_PRICE_CHANGED")
    return res.status(409).json({ error: e.message, code: e.code, currentPricing: e.currentPricing });
  if (e?.code === "SUBSCRIPTION_PRICE_ACCEPTANCE_REQUIRED")
    return res.status(428).json({ error: e.message, code: e.code });
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
      acceptedPricingVersion: parsed.data.acceptedPricingVersion,
      idempotencyKey: String(req.headers["idempotency-key"] || ""),
    });
    res.status(201).json({
      orderId: String(result.order._id),
      gatewayOrderId: result.order.gatewayOrderId,
      paymentSessionId: result.order.paymentSessionId,
      amountMinor: result.order.amountMinor,
      currency: result.order.currency,
      pricing: result.order.pricingSnapshot,
      checkoutEnvironment: subscriptionConfig.cashfreeEnvironment,
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
  }).strict().safeParse(req.body);
  if (!parsed.success) return error(res, 400, "Invalid payment verification request");
  try {
    res.json(await verifyPayment({ shopId: req.shopId, userId: req.user._id, ...parsed.data }));
  } catch (e) { serviceFailure(res, next, e); }
}

export async function handle_get_payment_status(req, res, next) {
  const parsed = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.params.orderId);
  if (!parsed.success) return error(res, 400, "Invalid payment order");
  try { res.json(await getPaymentOrderStatus({ shopId: req.shopId, orderId: parsed.data })); }
  catch (e) { serviceFailure(res, next, e); }
}

export async function handle_get_payment_attempt_status(req, res, next) {
  const parsed = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).safeParse(req.params.idempotencyKey);
  if (!parsed.success) return error(res, 400, "Invalid payment attempt");
  try { res.json(await getPaymentAttemptStatus({ shopId: req.shopId, idempotencyKey: parsed.data })); }
  catch (e) { serviceFailure(res, next, e); }
}

export async function handle_post_payment_webhook(req, res, next) {
  try {
    if (!Buffer.isBuffer(req.body)) return error(res, 400, "Invalid webhook body");
    const signature = String(req.headers["x-webhook-signature"] || "");
    const timestamp = String(req.headers["x-webhook-timestamp"] || "");
    if (!subscriptionConfig.cashfreeWebhookSecret || !/^\d{10,16}$/.test(timestamp) || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature))
      return error(res, 400, "Invalid webhook signature");
    const expected = createHmac("sha256", subscriptionConfig.cashfreeWebhookSecret)
      .update(timestamp)
      .update(req.body)
      .digest();
    const provided = Buffer.from(signature, "base64");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
      return error(res, 400, "Invalid webhook signature");
    const event = JSON.parse(req.body.toString("utf8"));
    const eventType = String(event.type || "");
    const orderId = String(event.data?.order?.order_id || "");
    const paymentId = String(event.data?.payment?.cf_payment_id || "");
    if (!orderId || !paymentId || !["PAYMENT_SUCCESS_WEBHOOK", "PAYMENT_FAILED_WEBHOOK", "PAYMENT_USER_DROPPED_WEBHOOK"].includes(eventType))
      return res.status(200).json({ received: true, ignored: true });
    const eventId = createHash("sha256")
      .update(`${eventType}:${orderId}:${paymentId}:${String(event.event_time || "")}`)
      .digest("hex");
    await processPaymentWebhook({ eventId, eventType, orderId, paymentId });
    res.status(200).json({ received: true });
  } catch (e) {
    if (e instanceof SyntaxError) return error(res, 400, "Invalid webhook body");
    serviceFailure(res, next, e);
  }
}
