import { Notification } from "../models.js";

export async function listNotifications(shopId) {
  const rows = await Notification.find({ shopId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(100)
    .lean();
  return {
    items: rows.map((notification) => ({
      id: String(notification._id),
      title: notification.title,
      body: notification.body,
      read: notification.read,
      date: notification.createdAt.toISOString(),
    })),
  };
}

export async function markNotificationsRead({ shopId, ids }) {
  return Notification.updateMany(
    { shopId, ...(ids.length ? { _id: { $in: ids } } : {}) },
    { $set: { read: true } },
  );
}
