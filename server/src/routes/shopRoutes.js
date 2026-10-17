import express from "express";
import { handle_get_shop, handle_patch_shop, handle_post_shop_register, handle_post_shop_resolve } from "../controllers/shopController.js";
import { auth, authAccount } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.post("/shop/register", authAccount, writeLimit, handle_post_shop_register);
router.get("/shop", auth, handle_get_shop);
router.patch("/shop", auth, writeLimit, handle_patch_shop);
router.post("/shop/resolve", auth, writeLimit, handle_post_shop_resolve);

export default router;
