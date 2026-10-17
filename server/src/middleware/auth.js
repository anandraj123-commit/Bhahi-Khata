import { jwtVerify } from "jose";
import { Shop, User } from "../models.js";
import { jwtKey } from "../config/env.js";
import { error } from "../utils/http.js";
import { normalizePhone } from "../utils/phone.js";

async function authenticatedUser(req, res) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return { response: error(res, 401, "Authentication required") };

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwtKey, {
      issuer: "digital-khata-api",
      audience: "digital-khata-app",
    }));
  } catch {
    return { response: error(res, 401, "Invalid or expired session") };
  }

  // Keep token failures distinct from database outages. Express 5 forwards
  // this rejected handler promise to the global error middleware as a 500.
  const user = await User.findOne({
    _id: payload.sub,
    disabledAt: { $exists: false },
  }).lean();
  if (!user || payload.ver !== (user.sessionVersion || 0))
    return { response: error(res, 401, "Session expired") };
  if (payload.sid && String(payload.sid) !== String(user.shopId || ""))
    return { response: error(res, 401, "Session expired") };
  return { user };
}

export async function authAccount(req, res, next) {
  const result = await authenticatedUser(req, res);
  if (result.response) return;
  req.user = result.user;
  const shop = result.user.shopId
    ? await Shop.findOne({ _id: result.user.shopId, ownerId: result.user._id }).select("_id phone").lean()
    : null;
  req.shopId = shop && normalizePhone(shop.phone) === normalizePhone(result.user.phone) ? shop._id : undefined;
  req.hasShop = Boolean(req.shopId);
  next();
}

export async function auth(req, res, next) {
  const result = await authenticatedUser(req, res);
  if (result.response) return;
  const user = result.user;
  const shop = user.shopId
    ? await Shop.findOne({ _id: user.shopId, ownerId: user._id }).select("_id phone").lean()
    : null;
  if (!shop || normalizePhone(shop.phone) !== normalizePhone(user.phone))
    return error(res, 409, "Complete shop setup before using shop data");
  req.user = user;
  req.shopId = shop._id;
  next();
}
