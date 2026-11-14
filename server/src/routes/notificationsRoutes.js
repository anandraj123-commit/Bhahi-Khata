import { campaignEligibility } from "../services/notificationsService.js";
import { prepareSubscriptionInbox } from "../notifications/subscriptionInbox.js";
import express from "express";
import { Notification } from "../models.js";
import { AdminNotification } from "../notifications/models.js";
import { NotificationMedia } from "../notifications/media.js";
import {
  handle_get_notifications,
  handle_patch_notifications_read,
  handle_reconcile_notifications,
  handle_get_notification,
} from "../controllers/notificationsController.js";
import { auth } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.get("/notifications", auth, handle_get_notifications);
router.post(
  "/notifications/subscription-reminders",
  auth,
  writeLimit,
  async (req, res) => {
    await prepareSubscriptionInbox(req.shopId, req.user._id);
    res.status(204).end();
  },
);
router.patch(
  "/notifications/read",
  auth,
  writeLimit,
  handle_patch_notifications_read,
);

router.post(
  "/notifications/reconcile",
  auth,
  writeLimit,
  handle_reconcile_notifications,
);
router.get("/notifications/:id", auth, handle_get_notification);

router.get("/notifications/:id/media/:mediaId", auth, async (req, res) => {
  if (
    ![req.params.id, req.params.mediaId].every((v) => /^[a-f\d]{24}$/i.test(v))
  )
    return res.status(400).json({ error: "Invalid image reference" });
  const inbox = await Notification.findOne({
    _id: req.params.id,
    shopId: req.shopId,
    recipientUserId: req.user._id,
    campaignMode: process.env.APP_MODE,
  })
    .select("campaignId")
    .lean();
  const campaign = await AdminNotification.exists({
    ...campaignEligibility(req.shopId),
    _id: inbox?.campaignId || req.params.id,
    mediaIds: req.params.mediaId,
  });
  if (!campaign) return res.status(404).json({ error: "Image unavailable" });
  const image = await NotificationMedia.findOne({
    _id: req.params.mediaId,
    appMode: process.env.APP_MODE,
  }).select("+bytes");
  if (!image) return res.status(404).json({ error: "Image unavailable" });
  res.set("Cache-Control", "private, no-store").json({
    contentType: image.contentType,
    data: image.bytes.toString("base64"),
    width: image.width,
    height: image.height,
  });
});

export default router;
