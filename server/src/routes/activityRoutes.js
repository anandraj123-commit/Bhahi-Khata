import express from "express";
import { handle_get_activity, handle_patch_activity_read } from "../controllers/activityController.js";
import { auth } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.get("/activity", auth, handle_get_activity);
router.patch("/activity/read", auth, writeLimit, handle_patch_activity_read);

export default router;
