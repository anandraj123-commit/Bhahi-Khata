import mongoose from "mongoose";
import { Session, Shop, User } from "../models.js";
import { digest } from "../utils/hashing.js";
import { issueTokens } from "./authService.js";

export async function findOrCreateAccount(phone) {
  let user = await User.findOne({ phone });
  if (!user) {
    try {
      await mongoose.connection.transaction(async (session) => {
        user = await User.findOne({ phone }).session(session);
        if (user) return;
        const userId = new mongoose.Types.ObjectId();
        const shopId = new mongoose.Types.ObjectId();
        const [created] = await User.create(
          [{ _id: userId, phone, shopId }],
          { session },
        );
        await Shop.create([{ _id: shopId, ownerId: userId, phone }], {
          session,
        });
        user = created;
      });
    } catch (e) {
      if (e.code !== 11000) throw e;
      user = await User.findOne({ phone });
    }
  }
  if (!user) return null;
  return user;
}

export async function isNewAccount(user) {
  return !Boolean((await Shop.findById(user.shopId).lean())?.name);
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
