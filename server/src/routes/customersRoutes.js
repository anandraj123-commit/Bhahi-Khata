import express from "express";
import { handle_delete_customers_id, handle_get_customers, handle_patch_customers_id, handle_post_customers, handle_post_customer_id_resolve } from "../controllers/customersController.js";
import { auth } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.get("/customers", auth, handle_get_customers);
router.post("/customers", auth, writeLimit, handle_post_customers);
router.patch("/customers/:id", auth, writeLimit, handle_patch_customers_id);
router.delete("/customers/:id", auth, writeLimit, handle_delete_customers_id);
router.post("/customers/:id/resolve", auth, writeLimit, handle_post_customer_id_resolve);

export default router;
