import pino from "pino";

export const log = pino({
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "*.phone",
    "*.token",
    "*.address",
    "*.body",
  ],
});

export function safeErrorContext(err) {
  const code =
    typeof err?.code === "string" && /^[A-Z0-9_-]{1,40}$/i.test(err.code)
      ? err.code
      : typeof err?.code === "number"
        ? err.code
        : undefined;
  return {
    errorName: typeof err?.name === "string" ? err.name.slice(0, 60) : "Error",
    ...(code !== undefined ? { errorCode: code } : {}),
  };
}
