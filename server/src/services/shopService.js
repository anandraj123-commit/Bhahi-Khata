import mongoose from "mongoose";
import { Shop } from "../models.js";
import { shopOut } from "../utils/serializers.js";
import { sameShopValues } from "../utils/records.js";

export async function getShop(shopId) {
  return Shop.findById(shopId).lean();
}

export async function updateShop({ shopId, input, base }) {
  const session = await mongoose.startSession();
  let shop;
  try {
    await session.withTransaction(async () => {
      shop = await Shop.findById(shopId).session(session);
      if (!shop) throw Object.assign(new Error("Shop not found"), { status: 404 });
      const current = shopOut(shop);
      if (
        base?.success &&
        !sameShopValues(current, base.data) &&
        !sameShopValues(current, input)
      )
        throw Object.assign(new Error("Shop settings changed on another device"), {
          status: 409,
        });
      if (!sameShopValues(current, input)) {
        shop.set(input);
        await shop.save({ session });
      }
    });
  } finally {
    await session.endSession();
  }
  return shop;
}
