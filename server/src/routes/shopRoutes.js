import express from "express";
import { handle_get_shop, handle_patch_shop } from "../controllers/shopController.js";
import { auth } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.get("/shop", auth, handle_get_shop);
router.patch("/shop", auth, writeLimit, handle_patch_shop);

export default router;
