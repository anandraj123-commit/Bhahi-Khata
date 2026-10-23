import express from "express";
import { auth } from "../middleware/auth.js";
import { writeLimit } from "../middleware/rateLimits.js";
import {
  handle_get_payment_status,
  handle_get_payment_attempt_status,
  handle_post_payment_verify,
  handle_post_payment_webhook,
} from "../controllers/subscriptionController.js";

const router = express.Router();
router.post("/payments/webhook", handle_post_payment_webhook);
router.post("/payments/verify", auth, writeLimit, handle_post_payment_verify);
router.get("/payments/attempts/:idempotencyKey/status", auth, handle_get_payment_attempt_status);
router.get("/payments/:orderId/status", auth, handle_get_payment_status);
export default router;
