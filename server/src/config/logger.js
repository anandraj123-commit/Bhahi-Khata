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
