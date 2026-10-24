import express from "express";
import { auth } from "../middleware/auth.js";
import { handle_get_referral_wallet } from "../controllers/referralController.js";

const router = express.Router();
router.get("/referral/summary", auth, handle_get_referral_wallet);
export default router;
