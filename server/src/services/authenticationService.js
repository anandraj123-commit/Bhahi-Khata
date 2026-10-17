import mongoose from "mongoose";
import { Session, Shop, User } from "../models.js";
import { digest } from "../utils/hashing.js";
import { normalizePhone, phoneLookupVariants } from "../utils/phone.js";
import { issueTokens } from "./authService.js";

function accountShopConflict() {
  return Object.assign(
    new Error("This mobile number has an inconsistent shop account link. Contact support to recover the existing shop."),
    { status: 409, code: "ACCOUNT_SHOP_LINK_CONFLICT" },
  );
}

async function findExistingAccount(phone) {
  const variants = phoneLookupVariants(phone);
  const users = await User.find({ phone: { $in: variants } }).limit(2).lean();
  if (users.length > 1) throw accountShopConflict();
  if (users.length === 1) {
    const user = users[0];
    if (normalizePhone(user.phone) !== phone) throw accountShopConflict();
    const shop = user.shopId
      ? await Shop.findById(user.shopId).lean()
      : null;
    if (shop && (String(shop.ownerId) !== String(user._id) || normalizePhone(shop.phone) !== phone))
      throw accountShopConflict();
    // A dangling legacy shopId is treated as incomplete only when no Shop
    // document exists for it and no competing phone-linked Shop exists.
    if (!shop) {
      const phoneShops = await Shop.find({ phone: { $in: variants } }).limit(2).lean();
      if (phoneShops.length) throw accountShopConflict();
      return { ...user, shopId: undefined };
    }
    if (String(shop.ownerId) !== String(user._id)) throw accountShopConflict();
    return user;
  }

  const shops = await Shop.find({ phone: { $in: variants } }).limit(2).lean();
  if (shops.length > 1) throw accountShopConflict();
  if (shops.length === 1) {
    const shop = shops[0];
    const owner = await User.findOne({ _id: shop.ownerId, shopId: shop._id }).lean();
    if (
      !owner ||
      normalizePhone(owner.phone) !== phone ||
      normalizePhone(shop.phone) !== phone
    )
      throw accountShopConflict();
    return owner;
  }
  return null;
}

export async function findOrCreateAccount(phone) {
  const normalizedPhone = normalizePhone(phone);
  let user = await findExistingAccount(normalizedPhone);
  if (!user) {
    try {
      await mongoose.connection.transaction(async (session) => {
        const existingUsers = await User.find({ phone: { $in: phoneLookupVariants(normalizedPhone) } })
          .limit(2).session(session).lean();
        if (existingUsers.length > 1) throw accountShopConflict();
        if (existingUsers.length === 1) {
          const existing = existingUsers[0];
          if (normalizePhone(existing.phone) !== normalizedPhone) throw accountShopConflict();
          const existingShop = existing.shopId
            ? await Shop.findById(existing.shopId).session(session).lean()
            : null;
          if (existingShop && (String(existingShop.ownerId) !== String(existing._id) || normalizePhone(existingShop.phone) !== normalizedPhone))
            throw accountShopConflict();
          const matchingShops = await Shop.find({ phone: { $in: phoneLookupVariants(normalizedPhone) } }).limit(2).session(session).lean();
          if (matchingShops.some((candidate) => String(candidate.ownerId) !== String(existing._id) || String(candidate._id) !== String(existing.shopId)))
            throw accountShopConflict();
          user = existingShop ? existing : { ...existing, shopId: undefined };
          return;
        }
        const matchingShops = await Shop.find({
          phone: { $in: phoneLookupVariants(normalizedPhone) },
        }).limit(2).session(session).lean();
        if (matchingShops.length) throw accountShopConflict();
        const userId = new mongoose.Types.ObjectId();
        const [created] = await User.create(
          [{ _id: userId, phone: normalizedPhone }],
          { session },
        );
        user = created;
      });
    } catch (e) {
      if (e.code !== 11000) throw e;
      user = await findExistingAccount(normalizedPhone);
      if (!user) throw accountShopConflict();
    }
  }
  if (!user) return null;
  return user;
}

export async function hasOwnedShop(user) {
  if (!user?.shopId) return false;
  const shop = await Shop.findOne({ _id: user.shopId, ownerId: user._id }).select("_id phone").lean();
  return Boolean(shop && normalizePhone(shop.phone) === normalizePhone(user.phone));
}

export async function rotateRefreshSession(refreshToken) {
  let result = null;
  const tokenHash = digest(refreshToken);
  await mongoose.connection.transaction(async (dbSession) => {
    const stored = await Session.findOne({
      tokenHash,
      expiresAt: { $gt: new Date() },
    }).session(dbSession);
    if (!stored) {
      result = null;
      return;
    }
    const user = await User.findById(stored.userId).session(dbSession);
    if (!user || user.disabledAt) {
      result = { unavailable: true };
      return;
    }
    const removed = await Session.deleteOne(
      { _id: stored._id, tokenHash },
      { session: dbSession },
    );
    if (removed.deletedCount !== 1) {
      result = null;
      return;
    }
    result = await issueTokens(user, dbSession);
  });
  return result;
}

export async function invalidateUserSessions(userId) {
  await mongoose.connection.transaction(async (dbSession) => {
    await User.updateOne(
      { _id: userId },
      { $inc: { sessionVersion: 1 } },
      { session: dbSession },
    );
    await Session.deleteMany({ userId }, { session: dbSession });
  });
}
