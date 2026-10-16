import { Device, SubscriptionNotificationLog } from "../models.js";
import { subscriptionConfig } from "../config/env.js";
import { sendPush } from "../providers.js";
import { log, safeErrorContext } from "../config/logger.js";

export async function sendSubscriptionPush({
  shopId,
  subscriptionId = null,
  notificationType,
  deduplicationKey,
  title,
  body,
}) {
  if (!subscriptionConfig.pushEnabled) return false;
  const tokens = await Device.find({ shopId }).distinct("token");
  if (!tokens.length) return false;
  let claim;
  try {
    claim = await SubscriptionNotificationLog.create({
      shopId,
      subscriptionId,
      notificationType,
      deduplicationKey,
      status: "scheduled",
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await SubscriptionNotificationLog.findOne({ shopId, deduplicationKey }).lean();
    if (existing?.status === "sent") return true;
    if (!existing || (existing.status === "scheduled" && Date.now() - new Date(existing.updatedAt).getTime() < 5 * 60 * 1000))
      return false;
    claim = await SubscriptionNotificationLog.findOneAndUpdate(
      { _id: existing._id, status: existing.status, updatedAt: existing.updatedAt },
      { $set: { status: "scheduled", sentAt: null } },
      { new: true },
    );
    if (!claim) return false;
  }
  try {
    const receipts = await sendPush(tokens, title, body, {
      screen: "subscription",
      shopId: String(shopId),
      subscriptionId: subscriptionId ? String(subscriptionId) : "",
      notificationType,
    });
    const errors = (receipts?.data || []).filter((receipt) => receipt.status === "error");
    if (errors.length === receipts?.data?.length)
      throw new Error("Push provider rejected all subscription notifications");
    await SubscriptionNotificationLog.updateOne(
      { _id: claim._id },
      { $set: { status: "sent", sentAt: new Date() } },
    );
    return true;
  } catch (error) {
    await SubscriptionNotificationLog.updateOne(
      { _id: claim._id },
      { $set: { status: "failed" } },
    ).catch(() => {});
    log.warn(
      { shopId: String(shopId), notificationType, ...safeErrorContext(error) },
      "subscription push notification failed",
    );
    return false;
  }
}
