import policy from "../../../shared/notificationImagePolicy.json" with { type: "json" };
import express from "express";
import notifications from "./routes/notificationsRoutes.js";
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
import customers from "./routes/customersRoutes.js";
import plans from "./routes/plansRoutes.js";
import referrals from "./routes/referralsRoutes.js";
import transactions from "./routes/transactionsRoutes.js";
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
      res.status(429).json({
        error: {
          code: "ADMIN_RATE_LIMITED",
          message: "Too many requests. Try again shortly.",
        },
      }),
  }),
);
const notificationJson = express.json({
  limit: policy.documentBytes,
  strict: true,
});
const adminJson = express.json({ limit: "32kb", strict: true });
router.use((req, res, next) => {
  const contentWrite =
    ["POST", "PATCH"].includes(req.method) &&
    /^\/notifications(?:\/[a-f\d]{24})?$/.test(req.path);
  return (contentWrite ? notificationJson : adminJson)(req, res, next);
});
router.use("/auth", auth);
router.use(authenticate);
router.use(customers);
router.use(transactions);
router.use("/plans", plans);
router.use(referrals);
router.use(reads);
router.use(notifications);
router.use("/administrators", administrators);
router.use("/settings", settings);
router.use((req, res) =>
  res.status(404).json({
    error: {
      code: "ADMIN_ROUTE_NOT_FOUND",
      message: "Administrative endpoint not found",
    },
  }),
);
router.use(adminError);
export default router;
