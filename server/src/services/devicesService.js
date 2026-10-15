import { Device } from "../models.js";

export async function registerPushToken({ shopId, token, platform }) {
  return Device.updateOne(
    { shopId, token },
    { $set: { platform, updatedAt: new Date() } },
    { upsert: true },
  );
}
