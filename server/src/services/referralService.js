import mongoose from "mongoose";
import {
  Customer,
  Referral,
  ReferralProgramSettings,
  Shop,
  WalletAccount,
  WalletLedgerEntry,
  createReferralCode,
} from "../models.js";

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  rewardAmountMinor: 0,
  referrerRewardAmountMinor: 0,
  referredRewardAmountMinor: 0,
  minimumCustomers: 1,
  revision: 1,
});

export async function referralSettings(session) {
  let query = ReferralProgramSettings.findById("default");
  if (session) query = query.session(session);
  const settings = await query.lean();
  if (!settings) return { ...DEFAULT_SETTINGS };
  const legacyReward = Number.isSafeInteger(settings.rewardAmountMinor) ? settings.rewardAmountMinor : 0;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    referrerRewardAmountMinor: settings.referrerRewardAmountMinor ?? legacyReward,
    referredRewardAmountMinor: settings.referredRewardAmountMinor ?? legacyReward,
  };
}

export async function attachReferral({ referralCode, referredShopId, referredOwnerId, session }) {
  const code = String(referralCode || "").trim().toUpperCase();
  if (!code) return null;
  if (!/^[A-F0-9]{10}$/.test(code))
    throw Object.assign(new Error("Referral code is invalid"), { status: 400, code: "REFERRAL_CODE_INVALID" });
  const settings = await referralSettings(session);
  if (!settings.enabled ||
      !Number.isSafeInteger(settings.referrerRewardAmountMinor) || settings.referrerRewardAmountMinor <= 0 ||
      !Number.isSafeInteger(settings.referredRewardAmountMinor) || settings.referredRewardAmountMinor <= 0)
    throw Object.assign(new Error("Referral rewards are not currently available"), { status: 409, code: "REFERRAL_PROGRAM_UNAVAILABLE" });
  let query = Shop.findOne({ referralCode: code });
  if (session) query = query.session(session);
  const referrer = await query.select("_id ownerId").lean();
  if (!referrer) throw Object.assign(new Error("Referral code was not found"), { status: 404, code: "REFERRAL_CODE_NOT_FOUND" });
  if (String(referrer.ownerId) === String(referredOwnerId) || String(referrer._id) === String(referredShopId))
    throw Object.assign(new Error("A shop cannot refer itself"), { status: 400, code: "REFERRAL_SELF_REFERRAL" });
  await Referral.create([{
    referrerShopId: referrer._id,
    referredShopId,
    referralCode: code,
    status: "pending",
    // Keep the legacy field as the referrer's amount while new consumers use
    // the explicit immutable participant-specific snapshots below.
    rewardAmountMinor: settings.referrerRewardAmountMinor,
    referrerRewardAmountMinor: settings.referrerRewardAmountMinor,
    referredRewardAmountMinor: settings.referredRewardAmountMinor,
    minimumCustomers: settings.minimumCustomers,
    settingsRevision: settings.revision,
  }], { session });
  return { referrerShopId: String(referrer._id), status: "pending" };
}

export async function qualifyReferralInTransaction(shopId, session) {
  const referral = await Referral.findOne({ referredShopId: shopId, status: "pending" }).session(session);
  if (!referral) return null;
  const eligibleCustomers = await Customer.countDocuments({
    shopId,
    deletedAt: { $exists: false },
    status: { $ne: false },
    disabled: { $ne: true },
    removed: { $ne: true },
  }).session(session);
  if (eligibleCustomers < referral.minimumCustomers) return null;
  const now = new Date();
  const qualified = await Referral.findOneAndUpdate(
    { _id: referral._id, status: "pending" },
    { $set: { status: "rewarded", qualifiedAt: now, rewardedAt: now } },
    { new: true, session },
  );
  if (!qualified) return null;
  const participants = [
    {
      shopId: qualified.referrerShopId,
      key: `referral:${qualified._id}:referrer`,
      amountMinor: qualified.referrerRewardAmountMinor ?? qualified.rewardAmountMinor,
      description: "Refer & Earn reward for referring a shop",
    },
    {
      shopId: qualified.referredShopId,
      key: `referral:${qualified._id}:referred`,
      amountMinor: qualified.referredRewardAmountMinor ?? qualified.rewardAmountMinor,
      description: "Refer & Earn reward for joining",
    },
  ];
  for (const participant of participants) {
    await WalletAccount.updateOne(
      { shopId: participant.shopId },
      { $setOnInsert: { shopId: participant.shopId, reservedMinor: 0 }, $inc: { balanceMinor: participant.amountMinor } },
      { upsert: true, session },
    );
    await WalletLedgerEntry.create([{
      shopId: participant.shopId,
      direction: "credit",
      amountMinor: participant.amountMinor,
      reason: "referral_reward",
      idempotencyKey: participant.key,
      referralId: qualified._id,
      description: participant.description,
    }], { session });
  }
  return qualified;
}

export async function ensureReferralCode(shopId) {
  let shop = await Shop.findOne({ _id: shopId }).select("referralCode").lean();
  if (!shop) throw Object.assign(new Error("Shop not found"), { status: 404 });
  if (!shop.referralCode) {
    const code = createReferralCode();
    try {
      shop = await Shop.findOneAndUpdate(
        { _id: shopId, $or: [{ referralCode: { $exists: false } }, { referralCode: null }] },
        { $set: { referralCode: code } },
        { new: true },
      ).select("referralCode").lean();
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    if (!shop?.referralCode) shop = await Shop.findById(shopId).select("referralCode").lean();
  }
  return shop.referralCode;
}

export async function getReferralWallet({ shopId, referralCursor, walletCursor, limit = 20 }) {
  if (referralCursor && !mongoose.isValidObjectId(referralCursor))
    throw Object.assign(new Error("Referral cursor is invalid"), { status: 400, code: "REFERRAL_CURSOR_INVALID" });
  if (walletCursor && !mongoose.isValidObjectId(walletCursor))
    throw Object.assign(new Error("Wallet cursor is invalid"), { status: 400, code: "WALLET_CURSOR_INVALID" });
  const pageSize = Math.min(50, Math.max(1, limit));
  const [referralCode, account] = await Promise.all([
    ensureReferralCode(shopId),
    WalletAccount.findOneAndUpdate(
      { shopId },
      { $setOnInsert: { shopId, balanceMinor: 0, reservedMinor: 0 } },
      { upsert: true, new: true },
    ).lean(),
  ]);
  const referralFilter = { $or: [{ referrerShopId: shopId }, { referredShopId: shopId }] };
  if (referralCursor) referralFilter._id = { $lt: new mongoose.Types.ObjectId(referralCursor) };
  const walletFilter = { shopId };
  if (walletCursor) walletFilter._id = { $lt: new mongoose.Types.ObjectId(walletCursor) };
  const [referralRows, walletRows, counts] = await Promise.all([
    Referral.find(referralFilter).sort({ _id: -1 }).limit(pageSize + 1).lean(),
    WalletLedgerEntry.find(walletFilter).sort({ _id: -1 }).limit(pageSize + 1).lean(),
    Referral.aggregate([
      { $match: { referrerShopId: new mongoose.Types.ObjectId(shopId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);
  const referralsHasMore = referralRows.length > pageSize;
  const walletHasMore = walletRows.length > pageSize;
  if (referralsHasMore) referralRows.pop();
  if (walletHasMore) walletRows.pop();
  const referralCounts = Object.fromEntries(counts.map(({ _id, count }) => [_id, count]));
  return {
    shopId: String(shopId),
    referralCode,
    referralUrlPath: `/refer/${referralCode}`,
    wallet: {
      balanceMinor: account?.balanceMinor || 0,
      availableMinor: Math.max(0, (account?.balanceMinor || 0) - (account?.reservedMinor || 0)),
      currency: "INR",
      items: walletRows.map((row) => ({
        id: String(row._id), direction: row.direction, amountMinor: row.amountMinor,
        reason: row.reason, description: row.description, createdAt: row.createdAt,
      })),
      nextCursor: walletHasMore ? String(walletRows.at(-1)._id) : null,
    },
    referrals: {
      counts: { pending: referralCounts.pending || 0, rewarded: referralCounts.rewarded || 0, rejected: referralCounts.rejected || 0 },
      items: referralRows.map((row) => ({
        id: String(row._id), role: String(row.referrerShopId) === String(shopId) ? "referred" : "you_were_referred",
        status: row.status,
        requiredCustomers: row.minimumCustomers,
        rewardMinor: String(row.referrerShopId) === String(shopId)
          ? (row.referrerRewardAmountMinor ?? row.rewardAmountMinor)
          : (row.referredRewardAmountMinor ?? row.rewardAmountMinor),
        qualifiedAt: row.qualifiedAt || null, createdAt: row.createdAt,
      })),
      nextCursor: referralsHasMore ? String(referralRows.at(-1)._id) : null,
    },
  };
}
