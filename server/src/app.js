import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import { randomBytes } from "node:crypto";
import { env } from "./config/env.js";
import { log } from "./config/logger.js";
import routes from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY === "true" ? 1 : false);
  app.use(helmet({ contentSecurityPolicy: false }));
  const origins = (env.APP_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || origins.includes(origin)) return cb(null, true);
        return cb(new Error("Origin not allowed"));
      },
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
      maxAge: 600,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "10mb", strict: true }));
  app.use(
    pinoHttp({
      logger: log,
      genReqId: (req) =>
        req.headers["x-request-id"]?.toString().slice(0, 80) ||
        randomBytes(12).toString("hex"),
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url.split("?")[0],
        }),
      },
    }),
  );
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api/v1", routes);
  app.use(errorHandler);
  return app;
}
