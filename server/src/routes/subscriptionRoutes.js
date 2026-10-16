import express from "express";
import { auth } from "../middleware/auth.js";
import { writeLimit } from "../middleware/rateLimits.js";
import {
  handle_get_subscription_current,
  handle_get_subscription_history,
  handle_get_subscription_plans,
  handle_get_subscription_usage,
  handle_get_subscription_payments,
  handle_post_subscription_checkout,
  handle_post_subscription_renew,
  handle_post_subscription_change_plan,
} from "../controllers/subscriptionController.js";

const router = express.Router();
router.get("/subscription/plans", auth, handle_get_subscription_plans);
router.get("/subscription/current", auth, handle_get_subscription_current);
router.get("/subscription/history", auth, handle_get_subscription_history);
router.get("/subscription/usage", auth, handle_get_subscription_usage);
router.get("/subscription/payments", auth, handle_get_subscription_payments);
router.post("/subscription/checkout", auth, writeLimit, handle_post_subscription_checkout);
router.post("/subscription/renew", auth, writeLimit, handle_post_subscription_renew);
router.post("/subscription/change-plan", auth, writeLimit, handle_post_subscription_change_plan);
export default router;
