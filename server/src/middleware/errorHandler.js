import { env } from "../config/env.js";
import { error } from "../utils/http.js";
import { log, safeErrorContext } from "../config/logger.js";

const safeStatusMessages = new Map([
  [400, "Invalid request"],
  [401, "Authentication required"],
  [403, "Access denied"],
  [404, "Resource not found"],
  [409, "Request conflicts with current data"],
  [413, "Request is too large"],
  [415, "Unsupported request content"],
  [429, "Too many requests. Try again later."],
]);

function publicFailure(err) {
  if (err?.message === "Origin not allowed")
    return { status: 403, message: "Origin not allowed" };
  if (err?.type === "entity.parse.failed")
    return { status: 400, message: "Invalid JSON request" };
  if (err?.type === "entity.too.large")
    return { status: 413, message: "Request is too large" };
  if (err?.name === "ValidationError" || err?.name === "ZodError")
    return { status: 400, message: "Invalid request" };
  if (err?.code === 11000)
    return { status: 409, message: "Record already exists" };
  if (err?.name === "CastError")
    return { status: 400, message: "Invalid request" };

  const status = Number(err?.status ?? err?.statusCode);
  if (safeStatusMessages.has(status))
    return { status, message: safeStatusMessages.get(status) };
  return { status: 500, message: "Request could not be completed" };
}

export function errorHandler(err, req, res, next) {
  (req.log || log).error(
    {
      requestId: req.id,
      method: req.method,
      route: req.route?.path,
      ...safeErrorContext(err),
    },
    "request failed",
  );
  if (res.headersSent) return next(err);
  const failure = publicFailure(err);
  // Never return database/provider messages, stack traces, or request data,
  // including in development. Expected domain errors are mapped by controllers.
  if (failure.status === 500 && env.NODE_ENV !== "production")
    (req.log || log).debug(
      { requestId: req.id },
      "Unexpected request failure details withheld from client",
    );
  return error(res, failure.status, failure.message);
}
