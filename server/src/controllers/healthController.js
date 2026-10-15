import mongoose from "mongoose";

export const handle_get_health = (req, res) =>
  res.json({
    status: mongoose.connection.readyState === 1 ? "ok" : "starting",
  });
