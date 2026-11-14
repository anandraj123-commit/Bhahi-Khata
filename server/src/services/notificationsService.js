import { createHash } from "node:crypto";
import { normalizeContent } from "../notifications/content.js";
import { fail } from "../admin/utils/security.js";
import mongoose from "mongoose";
import { Notification, ShopSubscription } from "../models.js";
import { AdminNotification } from "../notifications/models.js";
const oid = (v) => new mongoose.Types.ObjectId(v);
export const campaignReceiptId = (campaign, shop, user) =>
  new mongoose.Types.ObjectId(
    createHash("sha256")
      .update(`inbox:${campaign}:${shop}:${user}`)
      .digest("hex")
      .slice(0, 24),
  );
// Auth middleware establishes the current active owner of this shop. Visibility is
// deliberately independent of delivery workers and their publishedAt/lease state.
export function campaignEligibility(shopId, now = new Date()) {
  return {
    appMode: process.env.APP_MODE,
    status: true,
    deletedAt: { $exists: false },
    displayOn: { $lte: now },
    $or: [
      { recipientType: "all" },
      { recipientType: "selected", shopIds: oid(shopId) },
    ],
  };
}
const ownerScope = (shopId, userId) => ({
  shopId: oid(shopId),
  $or: [
    { recipientUserId: oid(userId) },
    { recipientUserId: { $exists: false } },
  ],
});
function combinedPipeline(shopId, userId, now) {
  return [
    {
      $match: {
        ...ownerScope(shopId, userId),
        campaignId: { $exists: false },
        $and: [
          {
            $or: [
              { visibleAfter: { $exists: false } },
              { visibleAfter: { $lte: now } },
            ],
          },
        ],
      },
    },
    {
      $lookup: {
        from: ShopSubscription.collection.name,
        localField: "subscriptionReminderId",
        foreignField: "_id",
        pipeline: [
          {
            $match: {
              shopId: oid(shopId),
              status: { $in: ["active", "scheduled", "expired"] },
              startsAt: { $lte: now },
            },
          },
          {
            $lookup: {
              from: ShopSubscription.collection.name,
              let: { expiry: "$expiresAt", subscription: "$_id" },
              pipeline: [
                {
                  $match: {
                    shopId: oid(shopId),
                    status: { $in: ["active", "scheduled"] },
                    $expr: {
                      $and: [
                        { $ne: ["$_id", "$$subscription"] },
                        { $lte: ["$startsAt", "$$expiry"] },
                        { $gt: ["$expiresAt", "$$expiry"] },
                      ],
                    },
                  },
                },
                { $limit: 1 },
                { $project: { _id: 1 } },
              ],
              as: "renewal",
            },
          },
          { $match: { "renewal.0": { $exists: false } } },
          { $project: { _id: 1 } },
        ],
        as: "validSubscription",
      },
    },
    {
      $match: {
        $or: [
          { subscriptionReminderId: { $exists: false } },
          { "validSubscription.0": { $exists: true } },
        ],
      },
    },
    {
      $project: { title: 1, body: 1, read: 1, category: 1, date: { $ifNull: ["$visibleAfter", "$createdAt"] } },
    },
    {
      $unionWith: {
        coll: AdminNotification.collection.name,
        pipeline: [
          { $match: campaignEligibility(shopId, now) },
          { $project: { title: 1, preview: 1, displayOn: 1 } },
          {
            $lookup: {
              from: Notification.collection.name,
              let: { campaign: "$_id" },
              pipeline: [
                {
                  $match: {
                    ...ownerScope(shopId, userId),
                    campaignMode: process.env.APP_MODE,
                    $expr: { $eq: ["$campaignId", "$$campaign"] },
                  },
                },
                { $project: { read: 1 } },
              ],
              as: "receipts",
            },
          },
          {
            $project: {
              title: 1,
              body: "$preview",
              date: "$displayOn",
              campaignId: "$_id",
              category: { $literal: "announcement" },
              aliases: "$receipts._id",
              read: { $in: [true, "$receipts.read"] },
            },
          },
        ],
      },
    },
  ];
}
export async function listNotifications(
  shopId,
  userId,
  { page = 1, limit = 20, ids } = {},
) {
  const now = new Date();
  const steps = combinedPipeline(shopId, userId, now);
  if (ids)
    steps.push({
      $match: {
        $or: [
          { _id: { $in: ids.map(oid) } },
          { aliases: { $in: ids.map(oid) } },
        ],
      },
    });
  const [r] = await Notification.aggregate([
    ...steps,
    {
      $facet: {
        items: [
          { $sort: { date: -1, _id: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],
        total: [{ $count: "count" }],
        unread: [{ $match: { read: { $ne: true } } }, { $count: "count" }],
      },
    },
  ]).option({ maxTimeMS: 10000 });
  const contentById = new Map();
  const campaigns = r.items
    .filter((n) => n.campaignId)
    .map((n) => n.campaignId);
  let bytes = 0;
  if (campaigns.length) {
    const cursor = AdminNotification.find({
      ...campaignEligibility(shopId, now),
      _id: { $in: campaigns },
    })
      .select("shortDescription description")
      .lean()
      .cursor({ batchSize: 2 });
    try {
      for await (const c of cursor) {
        bytes += Buffer.byteLength(JSON.stringify(c));
        if (bytes > 8 * 1024 * 1024)
          throw fail(
            413,
            "NOTIFICATION_PAGE_SIZE",
            "Request fewer rich notifications per page.",
          );
        contentById.set(String(c._id), c);
      }
    } finally {
      await cursor.close();
    }
  }
  const items = r.items
    .filter((n) => !n.campaignId || contentById.has(String(n.campaignId)))
    .map((n) => {
      const c = contentById.get(String(n.campaignId));
      return {
        id: String(n._id),
        aliases: (n.aliases || []).map(String),
        title: n.title,
        body: n.body,
        read: n.read === true,
        date: n.date?.toISOString(),
        category: n.category || "activity",
        shortDescription:
          typeof c?.shortDescription === "string"
            ? normalizeContent(c.shortDescription, 1000)
            : c?.shortDescription,
        description:
          typeof c?.description === "string"
            ? normalizeContent(c.description)
            : c?.description,
      };
    });
  return {
    items,
    total: r.total[0]?.count || 0,
    unread: r.unread[0]?.count || 0,
    page,
    hasMore: page * limit < (r.total[0]?.count || 0),
    serverTime: now.toISOString(),
  };
}
export async function markNotificationsRead({ shopId, userId, ids }) {
  // An empty acknowledgement must never mean "mark everything read".
  if (!ids.length) return;
  const rows = await Notification.aggregate([
    ...combinedPipeline(shopId, userId, new Date()),
    {
      $match: {
        $or: [
          { _id: { $in: ids.map(oid) } },
          { aliases: { $in: ids.map(oid) } },
        ],
      },
    },
    { $limit: 100 },
  ]).option({ maxTimeMS: 10000 });
  for (const row of rows) {
    if (!row.campaignId) {
      await Notification.updateOne(
        { _id: row._id, ...ownerScope(shopId, userId) },
        { $set: { read: true }, $min: { readAt: new Date() } },
      );
      continue;
    }
    const receiptId =
      row.aliases?.[0] || campaignReceiptId(row._id, shopId, userId);
    const query = { _id: receiptId, shopId: oid(shopId), campaignId: row._id };
    const update = {
      $set: { read: true },
      $min: { readAt: new Date() },
      $setOnInsert: {
        recipientUserId: oid(userId),
        campaignMode: process.env.APP_MODE,
        title: row.title,
        body: row.body,
        category: "announcement",
        createdAt: new Date(),
      },
    };
    try {
      await Notification.updateOne(query, update, { upsert: true });
    } catch (e) {
      if (e.code !== 11000) throw e;
      await Notification.updateOne(query, update);
    }
  }
}
