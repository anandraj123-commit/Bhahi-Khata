import express from "express";
import { handle_get_notifications, handle_patch_notifications_read } from "../controllers/notificationsController.js";
import { auth } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.get("/notifications", auth, handle_get_notifications);
router.patch("/notifications/read", auth, writeLimit, handle_patch_notifications_read);

export default router;
