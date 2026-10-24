import { Router } from "express";
import { permit, recentAuthentication } from "../middleware/security.js";
import { parse, referralSettingsUpdate } from "../validators/index.js";
import { getReferralSettings, updateReferralSettings } from "../services/referrals.js";

const router = Router();
router.get("/referrals/settings", permit("referrals:manage"), async (_req, res) => {
  res.json({ data: await getReferralSettings() });
});
router.patch("/referrals/settings", permit("referrals:manage"), recentAuthentication, async (req, res) => {
  const input = parse(referralSettingsUpdate, req.body);
  res.json({ data: await updateReferralSettings(req, input) });
});
export default router;
