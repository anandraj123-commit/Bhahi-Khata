import express from "express";
import { handle_delete_ledger_id, handle_get_ledger, handle_patch_ledger_id, handle_post_ledger, handle_post_ledger_id_resolve } from "../controllers/ledgerController.js";
import { auth } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.get("/ledger", auth, handle_get_ledger);
router.post("/ledger", auth, writeLimit, handle_post_ledger);
router.delete("/ledger/:id", auth, writeLimit, handle_delete_ledger_id);
router.patch("/ledger/:id", auth, writeLimit, handle_patch_ledger_id);
router.post("/ledger/:id/resolve", auth, writeLimit, handle_post_ledger_id_resolve);

export default router;
