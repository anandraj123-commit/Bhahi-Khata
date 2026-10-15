import express from "express";
import { handle_get_health } from "../controllers/healthController.js";

const router = express.Router();
router.get("/health", handle_get_health);

export default router;
