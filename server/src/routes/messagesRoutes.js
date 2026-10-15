import express from "express";
import { handle_post_messages_sms, handle_post_messages_whatsapp } from "../controllers/messagesController.js";
import { auth } from "../middleware/auth.js";
import { otpLimit, authLimit, writeLimit } from "../middleware/rateLimits.js";

const router = express.Router();
router.post("/messages/whatsapp", auth, writeLimit, handle_post_messages_whatsapp);
router.post("/messages/sms", auth, writeLimit, handle_post_messages_sms);

export default router;
