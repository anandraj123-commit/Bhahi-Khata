import { jwtVerify } from "jose";
import { User } from "../models.js";
import { jwtKey } from "../config/env.js";
import { error } from "../utils/http.js";

export async function auth(req, res, next) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return error(res, 401, "Authentication required");

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwtKey, {
      issuer: "digital-khata-api",
      audience: "digital-khata-app",
    }));
  } catch {
    return error(res, 401, "Invalid or expired session");
  }

  // Keep token failures distinct from database outages. Express 5 forwards
  // this rejected handler promise to the global error middleware as a 500.
  const user = await User.findOne({
    _id: payload.sub,
    shopId: payload.sid,
    disabledAt: { $exists: false },
  }).lean();
  if (!user || payload.ver !== (user.sessionVersion || 0))
    return error(res, 401, "Session expired");
  req.user = user;
  req.shopId = user.shopId;
  next();
}
