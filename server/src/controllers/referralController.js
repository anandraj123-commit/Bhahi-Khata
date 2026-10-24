import { getReferralWallet } from "../services/referralService.js";
import { error } from "../utils/http.js";

export async function handle_get_referral_wallet(req, res, next) {
  const limit = Number.parseInt(req.query.limit, 10) || 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    return error(res, 400, "Invalid referral page size");
  try {
    res.json(await getReferralWallet({
      shopId: req.shopId,
      referralCursor: String(req.query.referralCursor || ""),
      walletCursor: String(req.query.walletCursor || ""),
      limit,
    }));
  } catch (e) {
    if (e.status === 400 || e.status === 404) return error(res, e.status, e.message);
    next(e);
  }
}
