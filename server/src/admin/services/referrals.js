import mongoose from "mongoose";
import { ReferralProgramSettings } from "../../models.js";
import { audit } from "./audit.js";
import { fail } from "../utils/security.js";

const DEFAULTS = Object.freeze({
  enabled: false,
  rewardAmountMinor: 0,
  referrerRewardAmountMinor: 0,
  referredRewardAmountMinor: 0,
  minimumCustomers: 1,
  revision: 1,
});

function normalizeSettings(value) {
  if (!value) return { ...DEFAULTS };
  const legacyReward = Number.isSafeInteger(value.rewardAmountMinor) ? value.rewardAmountMinor : 0;
  const referrerRewardAmountMinor = value.referrerRewardAmountMinor ?? legacyReward;
  const referredRewardAmountMinor = value.referredRewardAmountMinor ?? legacyReward;
  return {
    ...DEFAULTS,
    ...value,
    rewardAmountMinor: referrerRewardAmountMinor,
    referrerRewardAmountMinor,
    referredRewardAmountMinor,
  };
}

export async function getReferralSettings() {
  const value = await ReferralProgramSettings.findById("default").lean();
  return normalizeSettings(value);
}

export async function updateReferralSettings(req, input) {
  let result;
  await mongoose.connection.transaction(async (session) => {
    const previous = await ReferralProgramSettings.findById("default").session(session).lean();
    const current = normalizeSettings(previous);
    const version = Number.isSafeInteger(previous?.revision) ? previous.revision : 1;
    if (version !== input.expectedVersion)
      throw fail(409, "ADMIN_REFERRAL_SETTINGS_CHANGED", "Refer & Earn settings changed. Refresh and try again.");
    const next = {
      enabled: input.enabled,
      referrerRewardAmountMinor: input.referrerRewardAmountMinor,
      referredRewardAmountMinor: input.referredRewardAmountMinor,
      // Retain the legacy common-reward field for older app/server readers;
      // explicit fields take precedence in the current implementation.
      rewardAmountMinor: input.referrerRewardAmountMinor,
      minimumCustomers: input.minimumCustomers,
      revision: version + 1,
    };
    await ReferralProgramSettings.updateOne(
      { _id: "default", ...(previous ? { revision: version } : { revision: { $exists: false } }) },
      { $set: next, $setOnInsert: { _id: "default" } },
      { upsert: true, session, runValidators: true },
    );
    await audit(req, "referrals.settings.update", "referral_program", "default", {
      previousEnabled: String(previous?.enabled ?? DEFAULTS.enabled),
      previousReferrerRewardAmountMinor: String(current.referrerRewardAmountMinor),
      previousReferredRewardAmountMinor: String(current.referredRewardAmountMinor),
      previousMinimumCustomers: String(previous?.minimumCustomers ?? DEFAULTS.minimumCustomers),
      enabled: String(next.enabled),
      referrerRewardAmountMinor: String(next.referrerRewardAmountMinor),
      referredRewardAmountMinor: String(next.referredRewardAmountMinor),
      minimumCustomers: String(next.minimumCustomers),
      revision: String(next.revision),
    }, session);
    result = next;
  });
  return result;
}
