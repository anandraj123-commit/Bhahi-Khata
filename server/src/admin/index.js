import express from "express";
import { log } from "../config/logger.js";
import { rateLimit } from "express-rate-limit";
import {
  trustedProxy,
  authenticate,
  adminError,
} from "./middleware/security.js";
import auth from "./routes/authRoutes.js";
import reads from "./routes/readRoutes.js";
import administrators from "./routes/administratorsRoutes.js";
import settings from "./routes/settingsRoutes.js";
const router = express.Router();
// Keep privileged cookies outside the mobile HTTP logger's response-header serializer.
router.use((req, res, next) => {
  req.log = log.child({ component: "admin" });
  next();
});
router.use(trustedProxy);
router.use(
  rateLimit({
    windowMs: 60000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) =>
      res
        .status(429)
        .json({
          error: {
            code: "ADMIN_RATE_LIMITED",
            message: "Too many requests. Try again shortly.",
          },
        }),
  }),
);
router.use(express.json({ limit: "32kb", strict: true }));
router.use("/auth", auth);
router.use(authenticate);
router.use(reads);
router.use("/administrators", administrators);
router.use("/settings", settings);
router.use((req, res) =>
  res
    .status(404)
    .json({
      error: {
        code: "ADMIN_ROUTE_NOT_FOUND",
        message: "Administrative endpoint not found",
      },
    }),
);
router.use(adminError);
export default router;
