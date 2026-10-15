import express from "express";
import { handle_get_bootstrap } from "../controllers/bootstrapController.js";
import { auth } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.get("/bootstrap", auth, handle_get_bootstrap);

export default router;
