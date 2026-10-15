import express from "express";
import { handle_post_devices_push_token } from "../controllers/devicesController.js";
import { auth } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.post("/devices/push-token", auth, writeLimit, handle_post_devices_push_token);

export default router;
