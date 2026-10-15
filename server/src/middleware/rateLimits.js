import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const limiter = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Try again later." },
  });

export const otpLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip)}:${String(req.body?.phone || "").slice(0, 20)}`,
  message: { error: "Too many OTP requests. Try again later." },
});
export const authLimit = limiter(15 * 60_000, 20);
export const writeLimit = limiter(60_000, 120);
export const apiLimit = limiter(60_000, 300);
