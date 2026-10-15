import express from "express";
import { handle_post_account_delete } from "../controllers/accountController.js";
import { auth } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.post("/account/delete", auth, handle_post_account_delete);

export default router;
