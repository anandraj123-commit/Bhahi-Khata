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
  const session = await Session.findOne({
    tokenHash: digest(refreshToken),
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  const user = await User.findById(session.userId);
  if (!user || user.disabledAt) return { unavailable: true };
  await session.deleteOne();
  return issueTokens(user);
}

export async function invalidateUserSessions(userId) {
  await User.updateOne({ _id: userId }, { $inc: { sessionVersion: 1 } });
  await Session.deleteMany({ userId });
}
