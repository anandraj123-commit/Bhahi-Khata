import { env } from "../config/env.js";
import { error } from "../utils/http.js";

export function errorHandler(err, req, res, next) {
  req.log?.error({ err }, "request failed");
  if (res.headersSent) return next(err);
  if (err?.name === "ValidationError" || err?.name === "ZodError")
    return error(res, 400, "Invalid request");
  if (err?.code === 11000) return error(res, 409, "Record already exists");
  if (err?.message === "Origin not allowed")
    return error(res, 403, "Origin not allowed");
  if (env.NODE_ENV === "production")
    return error(res, 500, "Request could not be completed");
  return error(res, 500, err.message || "Request could not be completed");
}
