import mongoose from "mongoose";
import {
  Shop,
  User,
  ShopSubscription,
  SubscriptionPlan,
  PaymentTransaction,
  PaymentOrder,
  SubscriptionAuditLog,
} from "../../models.js";
import { AdminAudit } from "../models/index.js";
import { fail, csvCell } from "../utils/security.js";
const oid = (value) => new mongoose.Types.ObjectId(value);
export const literalSearch = (text) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function dateRange(f, field = "createdAt") {
  const bounds = {};
  if (f.from) bounds.$gte = new Date(f.from);
  if (f.to) bounds.$lt = new Date(Date.parse(f.to) + 86400000);
  return Object.keys(bounds).length ? { [field]: bounds } : {};
}
export const activeSubscriptionMatch = (now) => ({
  status: { $in: ["active", "scheduled"] },
  startsAt: { $lte: now },
  $or: [{ expiresAt: { $gt: now } }, { expiresAt: null }],
});
export function subscriptionStatusMatch(status, now = new Date()) {
  if (!status) return {};
  if (status === "active") return activeSubscriptionMatch(now);
  if (status === "expiring")
    return {
      ...activeSubscriptionMatch(now),
      expiresAt: { $gt: now, $lte: new Date(now.getTime() + 30 * 86400000) },
    };
  if (status === "expired")
    return {
      $or: [
        { status: "expired" },
        { status: { $in: ["active", "scheduled"] }, expiresAt: { $lte: now } },
      ],
    };
  if (status === "scheduled")
    return { status: "scheduled", startsAt: { $gt: now } };
  if (status === "cancelled") return { status };
  throw fail(400, "ADMIN_FILTER_INVALID", "Unknown subscription status");
}
export const subscriptionProjection = {
  _id: 1,
  shopId: 1,
  planCode: 1,
  status: 1,
  startsAt: 1,
  expiresAt: 1,
  amountPaidMinor: 1,
  durationMonths: 1,
  createdAt: 1,
};
const shopLookup = {
  $lookup: {
    from: Shop.collection.name,
    localField: "shopId",
    foreignField: "_id",
    pipeline: [{ $project: { name: 1 } }],
    as: "shop",
  },
};
function shopFields() {
  return [
    {
      $addFields: {
        shopName: {
          $ifNull: [{ $arrayElemAt: ["$shop.name", 0] }, "Unavailable shop"],
        },
      },
    },
    { $unset: "shop" },
  ];
}
export const verifiedRevenueMatch = {
  verificationStatus: "verified",
  verifiedAt: { $type: "date" },
  status: { $in: ["captured", "partially_refunded", "refunded"] },
};
export const netRevenue = {
  $max: [
    0,
    { $subtract: ["$amountMinor", { $ifNull: ["$refundedAmountMinor", 0] }] },
  ],
};
const orderJoin = () => [
  {
    $lookup: {
      from: PaymentOrder.collection.name,
      localField: "orderId",
      foreignField: "_id",
      pipeline: [{ $project: { appMode: 1 } }],
      as: "order",
    },
  },
  {
    $match: {
      "order.appMode":
        process.env.APP_MODE ||
        (process.env.NODE_ENV === "production" ? "production" : "development"),
    },
  },
  { $unset: "order" },
];
async function aggregate(model, pipeline) {
  return model.aggregate(pipeline).option({ maxTimeMS: 10000 }).exec();
}
async function page(model, pipeline, f, projection) {
  const [result] = await aggregate(model, [
    ...pipeline,
    {
      $facet: {
        data: [
          {
            $sort:
              f.sort === "name"
                ? { name: 1, _id: 1 }
                : {
                    createdAt: f.sort === "oldest" ? 1 : -1,
                    _id: f.sort === "oldest" ? 1 : -1,
                  },
          },
          { $skip: (f.page - 1) * f.limit },
          { $limit: f.limit },
          ...(projection ? [{ $project: projection }] : []),
        ],
        total: [{ $count: "count" }],
      },
    },
  ]);
  return {
    data: result.data,
    pagination: {
      page: f.page,
      limit: f.limit,
      total: result.total[0]?.count || 0,
    },
  };
}
const searchStage = (f, fields) =>
  f.q
    ? [
        {
          $match: {
            $or: fields.map((field) => ({
              [field]: { $regex: literalSearch(f.q), $options: "i" },
            })),
          },
        },
      ]
    : [];
const ownerJoin = {
  $lookup: {
    from: User.collection.name,
    localField: "ownerId",
    foreignField: "_id",
    pipeline: [{ $project: { disabledAt: 1 } }],
    as: "account",
  },
};
const accountStatus = {
  $switch: {
    branches: [
      { case: { $eq: [{ $size: "$account" }, 0] }, then: "unavailable" },
      {
        case: {
          $ne: [
            { $ifNull: [{ $arrayElemAt: ["$account.disabledAt", 0] }, null] },
            null,
          ],
        },
        then: "disabled",
      },
    ],
    default: "enabled",
  },
};
export async function shops(f, support = false) {
  if (f.status && !["enabled", "disabled", "unavailable"].includes(f.status))
    throw fail(400, "ADMIN_FILTER_INVALID", "Unknown account status");
  const pipeline = [
    { $match: dateRange(f) },
    ...searchStage(f, ["name", "owner"]),
    ownerJoin,
    { $addFields: { accountStatus } },
    { $unset: "account" },
    {
      $lookup: {
        from: ShopSubscription.collection.name,
        localField: "_id",
        foreignField: "shopId",
        pipeline: [
          { $match: activeSubscriptionMatch(new Date()) },
          { $sort: { startsAt: -1, _id: -1 } },
          { $limit: 1 },
          { $project: subscriptionProjection },
        ],
        as: "subscription",
      },
    },
    {
      $addFields: {
        planCode: {
          $ifNull: [{ $arrayElemAt: ["$subscription.planCode", 0] }, "free"],
        },
        subscriptionExpiresAt: { $arrayElemAt: ["$subscription.expiresAt", 0] },
      },
    },
    ...(f.status ? [{ $match: { accountStatus: f.status } }] : []),
    ...(f.plan ? [{ $match: { planCode: f.plan } }] : []),
  ];
  return page(Shop, pipeline, f, {
    _id: 1,
    name: 1,
    owner: 1,
    createdAt: 1,
    accountStatus: 1,
    planCode: 1,
    subscriptionExpiresAt: 1,
    ...(support ? {} : { phone: 1 }),
  });
}
export async function subscriptions(f) {
  return page(
    ShopSubscription,
    [
      {
        $match: {
          ...dateRange(f),
          ...subscriptionStatusMatch(f.status),
          ...(f.plan ? { planCode: f.plan } : {}),
          ...(f.shopId ? { shopId: oid(f.shopId) } : {}),
        },
      },
      shopLookup,
      ...shopFields(),
      ...searchStage(f, ["shopName", "planCode"]),
    ],
    f,
    { ...subscriptionProjection, shopName: 1 },
  );
}
export async function payments(f) {
  if (
    f.status &&
    ![
      "captured",
      "pending",
      "failed",
      "refunded",
      "partially_refunded",
    ].includes(f.status)
  )
    throw fail(400, "ADMIN_FILTER_INVALID", "Unknown payment status");
  return page(
    PaymentTransaction,
    [
      {
        $match: {
          ...dateRange(f),
          ...(f.status ? { status: f.status } : {}),
          ...(f.shopId ? { shopId: oid(f.shopId) } : {}),
        },
      },
      ...orderJoin(),
      shopLookup,
      ...shopFields(),
      ...searchStage(f, ["shopName", "gatewayPaymentId", "gatewayOrderId"]),
    ],
    f,
    {
      _id: 1,
      shopId: 1,
      shopName: 1,
      gatewayPaymentId: 1,
      gatewayOrderId: 1,
      amountMinor: 1,
      currency: 1,
      status: 1,
      verificationStatus: 1,
      refundedAmountMinor: 1,
      verifiedAt: 1,
      createdAt: 1,
    },
  );
}
export async function auditLogs(f) {
  return page(
    AdminAudit,
    [
      {
        $match: {
          ...dateRange(f),
          ...(f.adminId ? { adminId: oid(f.adminId) } : {}),
        },
      },
      ...searchStage(f, ["action", "targetType", "targetId"]),
    ],
    f,
    {
      _id: 1,
      adminId: 1,
      action: 1,
      targetType: 1,
      targetId: 1,
      result: 1,
      createdAt: 1,
      correlationId: 1,
      metadata: 1,
    },
  );
}
export async function shopDetail(id, support) {
  const rows = await aggregate(Shop, [
    { $match: { _id: oid(id) } },
    ownerJoin,
    { $addFields: { accountStatus } },
    {
      $project: {
        name: 1,
        owner: 1,
        createdAt: 1,
        accountStatus: 1,
        ...(support ? {} : { phone: 1, address: 1, whatsapp: 1 }),
      },
    },
  ]);
  if (!rows.length) throw fail(404, "ADMIN_SHOP_NOT_FOUND", "Shop not found");
  const current = await ShopSubscription.findOne({
    shopId: id,
    ...activeSubscriptionMatch(new Date()),
  })
    .select(subscriptionProjection)
    .sort({ startsAt: -1, _id: -1 })
    .maxTimeMS(5000)
    .lean();
  const history = support
    ? []
    : await SubscriptionAuditLog.find({ shopId: id })
        .select("eventType occurredAt actorType")
        .sort({ occurredAt: -1, _id: -1 })
        .limit(20)
        .maxTimeMS(5000)
        .lean();
  return {
    shop: rows[0],
    subscription: current || {
      planCode: "free",
      status: "active",
      startsAt: null,
      expiresAt: null,
    },
    history,
  };
}
export async function dashboard(f, includeAudit = true) {
  const now = new Date();
  const from =
    f.from ||
    new Date((f.to ? Date.parse(f.to) : now.getTime()) - 29 * 86400000)
      .toISOString()
      .slice(0, 10);
  const range = { ...f, from };
  const bucket = (field) => ({
    $dateToString: { format: "%Y-%m-%d", date: `$${field}`, timezone: "UTC" },
  });
  const [
    totalShops,
    enabled,
    subscriptionCounts,
    registrations,
    subscriptionGrowth,
    revenue,
    revenueTrend,
    distribution,
    recentShops,
    recentAudit,
    plans,
  ] = await Promise.all([
    Shop.countDocuments().maxTimeMS(10000),
    aggregate(Shop, [
      ownerJoin,
      { $addFields: { accountStatus } },
      { $match: { accountStatus: "enabled" } },
      { $count: "count" },
    ]),
    aggregate(ShopSubscription, [
      {
        $facet: {
          total: [{ $count: "count" }],
          active: [
            { $match: activeSubscriptionMatch(now) },
            { $count: "count" },
          ],
          expiring: [
            { $match: subscriptionStatusMatch("expiring", now) },
            { $count: "count" },
          ],
          expired: [
            { $match: subscriptionStatusMatch("expired", now) },
            { $count: "count" },
          ],
        },
      },
    ]),
    aggregate(Shop, [
      { $match: dateRange(range) },
      { $group: { _id: bucket("createdAt"), count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $limit: 366 },
    ]),
    aggregate(ShopSubscription, [
      { $match: dateRange(range) },
      { $group: { _id: bucket("createdAt"), count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $limit: 366 },
    ]),
    aggregate(PaymentTransaction, [
      {
        $match: { ...verifiedRevenueMatch, ...dateRange(range, "verifiedAt") },
      },
      ...orderJoin(),
      {
        $group: {
          _id: "$currency",
          amountMinor: { $sum: netRevenue },
          count: { $sum: 1 },
        },
      },
      { $limit: 20 },
    ]),
    aggregate(PaymentTransaction, [
      {
        $match: { ...verifiedRevenueMatch, ...dateRange(range, "verifiedAt") },
      },
      ...orderJoin(),
      {
        $group: {
          _id: { date: bucket("verifiedAt"), currency: "$currency" },
          amountMinor: { $sum: netRevenue },
        },
      },
      { $sort: { "_id.date": 1 } },
      { $limit: 7320 },
    ]),
    aggregate(ShopSubscription, [
      { $match: activeSubscriptionMatch(now) },
      { $group: { _id: "$planCode", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]),
    Shop.find()
      .select("name owner createdAt")
      .sort({ createdAt: -1, _id: -1 })
      .limit(5)
      .maxTimeMS(5000)
      .lean(),
    includeAudit
      ? AdminAudit.find()
          .select("action result createdAt")
          .sort({ createdAt: -1 })
          .limit(5)
          .maxTimeMS(5000)
          .lean()
      : [],
    SubscriptionPlan.find({ enabled: true })
      .select(
        "code name monthlyPriceMinor currency customerLimit unlimitedCustomers",
      )
      .sort({ displayOrder: 1 })
      .limit(50)
      .maxTimeMS(5000)
      .lean(),
  ]);
  const counts = subscriptionCounts[0];
  const count = (key) => counts[key][0]?.count || 0;
  return {
    metrics: {
      totalShops,
      activeShops: enabled[0]?.count || 0,
      totalSubscriptions: count("total"),
      activeSubscriptions: count("active"),
      expiringSubscriptions: count("expiring"),
      expiredSubscriptions: count("expired"),
      recentRegistrations: registrations.reduce((sum, r) => sum + r.count, 0),
      revenue,
    },
    registrations,
    subscriptionGrowth,
    revenueTrend,
    distribution,
    recentShops,
    recentAudit,
    plans,
    definitions: {
      activeShops:
        "Shops whose linked owner account exists and has no disabledAt value; not a measure of recent usage.",
      subscriptions:
        "Persisted subscription records. Implicit Free-plan fallbacks are not counted. Active includes effective scheduled records, matching mobile entitlement rules.",
      expiring: "Effective subscriptions expiring within the next 30 days.",
      revenue:
        "Verified captured/refunded subscription payments in the current backend app mode, less recorded refunds, grouped by currency and verification date. Not shopkeeper ledger revenue.",
      activeShopTrend:
        "Unavailable: historical account-activity snapshots are not recorded.",
    },
    period: { from, to: f.to || now.toISOString().slice(0, 10) },
  };
}
export function reportCsv(report) {
  const rows = [
    ["Report", "Date or currency", "Value", "Unit"],
    ...report.registrations.map((r) => [
      "Shop registrations",
      r._id,
      r.count,
      "shops",
    ]),
    ...report.subscriptionGrowth.map((r) => [
      "Subscription growth",
      r._id,
      r.count,
      "records",
    ]),
    ...report.metrics.revenue.map((r) => [
      "Verified net revenue",
      r._id,
      r.amountMinor,
      "minor currency units",
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
