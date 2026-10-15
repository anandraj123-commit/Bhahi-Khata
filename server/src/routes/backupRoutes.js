import express from "express";
import { handle_post_backup_restore } from "../controllers/backupController.js";
import { auth } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.post("/backup/restore", auth, writeLimit, handle_post_backup_restore);

export default router;
