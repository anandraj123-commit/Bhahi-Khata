import { Device, Shop, User } from "../models.js";

// Never infer ownership from the newest of several historical registrations.
// Ambiguous tokens are withheld from every notification category.
export async function ownedPushDevices(shopId) {
  const shop = await Shop.findById(shopId).select("ownerId").lean();
  if (
    !shop ||
    !(await User.exists({
      _id: shop.ownerId,
      shopId,
      disabledAt: { $exists: false },
    }))
  )
    return [];
  const devices = await Device.find({ shopId })
    .select("token updatedAt")
    .limit(100)
    .lean();
  const tokens = [...new Set(devices.map((d) => d.token))];
  const conflicts = new Set(
    await Device.find({
      token: { $in: tokens },
      shopId: { $ne: shopId },
    }).distinct("token"),
  );
  return [
    ...new Map(
      devices.filter((d) => !conflicts.has(d.token)).map((d) => [d.token, d]),
    ).values(),
  ];
}
export async function removeInvalidPushDevices(shopId, devices, tickets) {
  for (let i = 0; i < devices.length; i++) {
    const device = devices[i];
    if (
      tickets?.[i]?.status === "error" &&
      tickets[i].details?.error === "DeviceNotRegistered" &&
      device.updatedAt
    )
      await Device.deleteMany({
        shopId,
        token: device.token,
        updatedAt: { $lte: device.updatedAt },
      });
  }
}
