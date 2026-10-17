import express from "express";
import { handle_post_auth_logout, handle_post_auth_otp_start, handle_post_auth_otp_verify, handle_post_auth_refresh } from "../controllers/authController.js";
import { authAccount } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.post("/auth/otp/start", otpLimit, handle_post_auth_otp_start);
router.post("/auth/otp/verify", authLimit, handle_post_auth_otp_verify);
router.post("/auth/refresh", authLimit, handle_post_auth_refresh);
router.post("/auth/logout", authAccount, handle_post_auth_logout);

export default router;
