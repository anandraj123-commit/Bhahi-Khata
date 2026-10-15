export const error = (res, status, message) =>
  res.status(status).json({ error: message });
