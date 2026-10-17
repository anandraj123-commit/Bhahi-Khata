import express from "express";
import { handle_get_bootstrap } from "../controllers/bootstrapController.js";
import { authAccount } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.get("/bootstrap", authAccount, handle_get_bootstrap);

export default router;
