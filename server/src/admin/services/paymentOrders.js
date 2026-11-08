import mongoose from "mongoose";
import {
  PaymentOrder,
  PaymentTransaction,
  PaymentRefund,
  PaymentWebhookEvent,
  Shop,
  ShopSubscription,
  SubscriptionAuditLog,
} from "../../models.js";
import { fail } from "../utils/security.js";
import { AdminAudit } from "../models/index.js";
const oid = (v) => new mongoose.Types.ObjectId(v);
const projection = (keys) =>
  Object.fromEntries(keys.split(" ").map((k) => [k, 1]));
const mode = () => ({ appMode: process.env.APP_MODE });
const legacyMode = () => ({ $or: [mode(), { appMode: { $exists: false } }] });
const orderProjection = projection(
  "_id shopId appMode planId planCode durationMonths amountMinor totalAmountMinor walletAppliedMinor walletReservationStatus currency gatewayOrderId gatewayReferenceId status scheduledStartAt checkoutActive checkoutExpiresAt verifiedAt paymentReconciliationAttempts paymentReconciliationNextAt paymentReconciliationLastCode paymentReconciliationCheckedAt paymentReconciliationAttemptedAt refundReconciliationCheckedAt refundReconciliationLastCode gatewayOrderStatus latestPaymentId latestPaymentStatus latestPaymentTime createdAt updatedAt",
);
const priceKeys =
  "basePriceMinor discountPercent discountAmountMinor taxableAmountMinor taxPercent taxAmountMinor finalAmountMinor walletAppliedMinor cashPayableMinor currency durationMonths";
const attemptProjection = projection(
  "_id orderId shopId appMode provider gatewayPaymentId gatewayOrderId amountMinor currency method status verificationStatus reviewStatus reviewReason refundedAmountMinor refundReferences gatewayCreatedAt gatewayStatus verifiedAt createdAt updatedAt",
);
const refundProjection = projection(
  "_id orderId gatewayOrderId gatewayPaymentId gatewayRefundId refundId amountMinor currency gatewayStatus verifiedAt entitlementReviewRequired createdAt updatedAt",
);
const webhookProjection = projection(
  "_id eventId eventType orderId paymentId refundId attempts nextAttemptAt lastErrorCode processedAt status createdAt updatedAt",
);
const subProjection = projection(
  "_id shopId planCode durationMonths status startsAt expiresAt scheduledStartAt activatedAt amountPaidMinor remainingMilliseconds pauseReason renewalOf sourcePaymentOrderId sourcePaymentId createdAt updatedAt",
);
const priceProjection = Object.fromEntries([
  ...priceKeys.split(" ").map((k) => ["pricingSnapshot." + k, 1]),
  ["pricingSnapshot.plan.name", 1],
  ["pricingSnapshot.plan.code", 1],
  ["pricingSnapshot.plan.tier", 1],
  ["confirmedPreview.outcome.message", 1],
  ["confirmedPreview.outcome.startsAt", 1],
  ["confirmedPreview.outcome.expiresAt", 1],
]);
const sumIf = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });
const agg = (model, pipeline) =>
  model.aggregate(pipeline).allowDiskUse(true).option({ maxTimeMS: 10000 });
const liveCapture = {
  $and: [
    { $eq: ["$verificationStatus", "verified"] },
    { $eq: [{ $type: "$verifiedAt" }, "date"] },
    { $in: ["$status", ["captured", "refunded", "partially_refunded"]] },
  ],
};
function subscriptions(orderExpr, shopExpr) {
  return [
    { $match: { $expr: { $eq: ["$shopId", shopExpr] } } },
    {
      $lookup: {
        from: PaymentTransaction.collection.name,
        localField: "sourcePaymentId",
        foreignField: "_id",
        pipeline: [
          {
            $match: {
              ...legacyMode(),
              $expr: {
                $and: [
                  { $eq: ["$orderId", orderExpr] },
                  { $eq: ["$shopId", shopExpr] },
                ],
              },
            },
          },
          { $project: { _id: 1 } },
        ],
        as: "sourceAttempt",
      },
    },
    {
      $match: {
        $expr: {
          $or: [
            { $eq: ["$sourcePaymentOrderId", orderExpr] },
            {
              $and: [
                { $eq: [{ $type: "$sourcePaymentOrderId" }, "missing"] },
                { $gt: [{ $size: "$sourceAttempt" }, 0] },
              ],
            },
          ],
        },
      },
    },
  ];
}
function joins() {
  return [
    {
      $lookup: {
        from: Shop.collection.name,
        localField: "shopId",
        foreignField: "_id",
        pipeline: [{ $project: { name: 1, phone: 1, owner: 1, address: 1 } }],
        as: "shop",
      },
    },
    {
      $set: {
        shopName: { $ifNull: [{ $first: "$shop.name" }, "Unavailable shop"] },
        shop: { $first: "$shop" },
      },
    },
    {
      $lookup: {
        from: PaymentTransaction.collection.name,
        let: {
          o: "$_id",
          s: "$shopId",
          g: "$gatewayOrderId",
          c: "$currency",
          a: "$amountMinor",
        },
        pipeline: [
          {
            $match: {
              ...legacyMode(),
              $expr: {
                $and: [
                  { $eq: ["$orderId", "$$o"] },
                  { $eq: ["$shopId", "$$s"] },
                  { $eq: ["$gatewayOrderId", "$$g"] },
                  { $eq: ["$currency", "$$c"] },
                ],
              },
            },
          },
          {
            $group: {
              _id: "$gatewayPaymentId",
              documents: { $sum: 1 },
              verifiedAmount: {
                $max: {
                  $cond: [
                    {
                      $and: [
                        liveCapture,
                        { $eq: ["$amountMinor", "$$a"] },
                        { $eq: [{ $type: "$gatewayPaymentId" }, "string"] },
                        { $ne: ["$gatewayPaymentId", ""] },
                      ],
                    },
                    "$amountMinor",
                    0,
                  ],
                },
              },
              successful: { $max: { $cond: [liveCapture, 1, 0] } },
              failed: {
                $max: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
              },
              pending: {
                $max: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
              },
              review: {
                $max: {
                  $cond: [
                    {
                      $or: [
                        { $eq: ["$reviewStatus", "duplicate_order_capture"] },
                        { $ne: ["$amountMinor", "$$a"] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              verifiedPaidMinor: {
                $sum: {
                  $cond: [{ $eq: ["$documents", 1] }, "$verifiedAmount", 0],
                },
              },
              successful: { $sum: "$successful" },
              failed: { $sum: "$failed" },
              pending: { $sum: "$pending" },
              duplicate: {
                $sum: { $cond: [{ $gt: ["$documents", 1] }, 1, "$review"] },
              },
            },
          },
        ],
        as: "attemptStats",
      },
    },
    {
      $set: {
        attemptStats: {
          $ifNull: [
            { $first: "$attemptStats" },
            {
              count: 0,
              verifiedPaidMinor: 0,
              successful: 0,
              failed: 0,
              pending: 0,
              duplicate: 0,
            },
          ],
        },
      },
    },
    {
      $lookup: {
        from: ShopSubscription.collection.name,
        let: { o: "$_id", s: "$shopId" },
        pipeline: [
          ...subscriptions("$$o", "$$s"),
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              statuses: { $addToSet: "$status" },
            },
          },
        ],
        as: "subscriptionStats",
      },
    },
    {
      $set: {
        subscriptionStats: {
          $ifNull: [
            { $first: "$subscriptionStats" },
            { count: 0, statuses: [] },
          ],
        },
      },
    },
    {
      $lookup: {
        from: PaymentRefund.collection.name,
        let: { o: "$_id", s: "$shopId", g: "$gatewayOrderId" },
        pipeline: [
          {
            $match: {
              ...mode(),
              $expr: {
                $and: [
                  { $eq: ["$orderId", "$$o"] },
                  { $eq: ["$shopId", "$$s"] },
                  { $eq: ["$gatewayOrderId", "$$g"] },
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              statuses: { $addToSet: "$gatewayStatus" },
            },
          },
        ],
        as: "refundStats",
      },
    },
    {
      $set: {
        refundStats: {
          $ifNull: [{ $first: "$refundStats" }, { count: 0, statuses: [] }],
        },
        attention: {
          $or: [
            {
              $gt: [
                {
                  $strLenCP: {
                    $ifNull: ["$paymentReconciliationLastCode", ""],
                  },
                },
                0,
              ],
            },
            {
              $gt: [
                {
                  $strLenCP: { $ifNull: ["$refundReconciliationLastCode", ""] },
                },
                0,
              ],
            },
            { $gt: ["$attemptStats.duplicate", 0] },
            {
              $and: [
                {
                  $in: ["$status", ["paid", "refunded", "partially_refunded"]],
                },
                { $eq: ["$subscriptionStats.count", 0] },
              ],
            },
            {
              $and: [
                { $eq: ["$gatewayOrderStatus", "PAID"] },
                { $in: ["$status", ["created", "pending", "failed"]] },
              ],
            },
          ],
        },
      },
    },
  ];
}
export async function listPaymentOrders(f) {
  const match = { ...mode() };
  if (f.shopId) match.shopId = oid(f.shopId);
  if (f.status) match.status = f.status;
  if (f.paymentStatus) match.latestPaymentStatus = f.paymentStatus;
  if (f.gatewayStatus) match.gatewayOrderStatus = f.gatewayStatus;
  if (f.plan) match.planCode = f.plan;
  if (f.durationMonths) match.durationMonths = f.durationMonths;
  if (f.from || f.to)
    match[f.dateField] = {
      ...(f.from ? { $gte: new Date(f.from + "T00:00:00.000Z") } : {}),
      ...(f.to
        ? { $lt: new Date(Date.parse(f.to + "T00:00:00.000Z") + 86400000) }
        : {}),
    };
  if (f.amountMin !== undefined || f.amountMax !== undefined)
    match.amountMinor = {
      ...(f.amountMin !== undefined
        ? { $gte: Math.round(f.amountMin * 100) }
        : {}),
      ...(f.amountMax !== undefined
        ? { $lte: Math.round(f.amountMax * 100) }
        : {}),
    };
  // Prefix shop search and exact payment identifiers; never unrestricted substring regex.
  if (f.q) {
    const literal = f.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shopQuery = {
      $or: [
        { name: { $regex: "^" + literal, $options: "i" } },
        { phone: { $regex: "^" + literal } },
      ],
    };
    const shops = await Shop.find(shopQuery)
      .select("_id")
      .limit(201)
      .maxTimeMS(5000)
      .lean();
    if (shops.length > 200)
      throw fail(
        400,
        "ADMIN_SEARCH_TOO_BROAD",
        "Refine the shop search or choose a specific shop.",
      );
    const attemptMatch = {
      $and: [
        legacyMode(),
        {
          $or: [
            { gatewayPaymentId: f.q },
            { gatewayOrderId: f.q },
            ...(/^[a-f\d]{24}$/i.test(f.q) ? [{ _id: oid(f.q) }] : []),
          ],
        },
      ],
    };
    const candidates = await PaymentTransaction.find(attemptMatch)
      .select("orderId shopId gatewayOrderId")
      .limit(201)
      .maxTimeMS(5000)
      .lean();
    if (candidates.length > 200)
      throw fail(
        400,
        "ADMIN_SEARCH_TOO_BROAD",
        "Refine the payment identifier.",
      );
    const resolved = await attachOrderLinks(candidates);
    const attempts = resolved.filter((row) => row.resolvedOrderId);
    if (attempts.length > 200)
      throw fail(
        400,
        "ADMIN_SEARCH_TOO_BROAD",
        "Refine the payment identifier.",
      );
    match.$or = [
      { gatewayOrderId: f.q },
      { gatewayReferenceId: f.q },
      { shopId: { $in: shops.map((s) => s._id) } },
      { _id: { $in: attempts.map((a) => a.orderId).filter(Boolean) } },
      ...(/^[a-f\d]{24}$/i.test(f.q)
        ? [{ _id: oid(f.q) }, { shopId: oid(f.q) }]
        : []),
    ];
  }
  const after = {};
  if (f.reconciliation === "pending")
    after.status = { $in: ["created", "pending"] };
  if (f.reconciliation === "error")
    after.$or = [
      { paymentReconciliationLastCode: { $exists: true, $nin: ["", null] } },
      { refundReconciliationLastCode: { $exists: true, $nin: ["", null] } },
    ];
  if (f.reconciliation === "checked")
    after.paymentReconciliationCheckedAt = { $type: "date" };
  if (f.reconciliation === "unverified") after.verifiedAt = { $exists: false };
  if (f.subscriptionStatus)
    after[
      f.subscriptionStatus === "missing"
        ? "subscriptionStats.count"
        : "subscriptionStats.statuses"
    ] = f.subscriptionStatus === "missing" ? 0 : f.subscriptionStatus;
  if (f.refundStatus) after["refundStats.statuses"] = f.refundStatus;
  if (f.attempts)
    after[
      "attemptStats." +
        {
          none: "count",
          multiple: "count",
          successful: "successful",
          failed: "failed",
          pending: "pending",
        }[f.attempts]
    ] = f.attempts === "none" ? 0 : { $gt: f.attempts === "multiple" ? 1 : 0 };
  if (f.attention) after.attention = true;
  const sortField =
    { newest: "createdAt", oldest: "createdAt", name: "shopName" }[f.sort] ||
    f.sort;
  const direction =
    f.sort === "oldest" || f.sort === "name"
      ? 1
      : f.direction === "asc"
        ? 1
        : -1;
  const [result] = await agg(PaymentOrder, [
    { $match: match },
    ...joins(),
    { $match: after },
    {
      $facet: {
        data: [
          { $sort: { [sortField]: direction, _id: direction } },
          { $skip: (f.page - 1) * f.limit },
          { $limit: f.limit },
          {
            $project: {
              ...orderProjection,
              ...priceProjection,
              shop: 1,
              shopName: 1,
              attemptStats: 1,
              subscriptionStats: 1,
              refundStats: 1,
              attention: 1,
            },
          },
        ],
        summary: [
          {
            $group: {
              _id: "$currency",
              total: { $sum: 1 },
              paid: sumIf({ $eq: ["$status", "paid"] }),
              pending: sumIf({ $in: ["$status", ["created", "pending"]] }),
              failed: sumIf({ $eq: ["$status", "failed"] }),
              expired: sumIf({ $eq: ["$gatewayOrderStatus", "EXPIRED"] }),
              attention: sumIf("$attention"),
              verifiedPaidMinor: { $sum: "$attemptStats.verifiedPaidMinor" },
              multipleAttempts: sumIf({ $gt: ["$attemptStats.count", 1] }),
            },
          },
        ],
      },
    },
  ]);
  const total = result.summary.reduce((n, r) => n + r.total, 0);
  return {
    data: result.data,
    pagination: {
      page: f.page,
      limit: f.limit,
      total,
      pages: Math.ceil(total / f.limit),
    },
    summary: result.summary,
  };
}
async function parent(id) {
  const order = await PaymentOrder.findOne({ _id: oid(id), ...mode() })
    .select({ ...orderProjection, ...priceProjection })
    .maxTimeMS(5000)
    .lean();
  if (!order)
    throw fail(
      404,
      "ADMIN_ORDER_NOT_FOUND",
      "Payment order not found in this environment. No replacement order was created.",
    );
  return order;
}
export async function paymentOrderDetail(id) {
  await parent(id);
  const [order] = await agg(PaymentOrder, [
    { $match: { _id: oid(id), ...mode() } },
    ...joins(),
    {
      $project: {
        ...orderProjection,
        ...priceProjection,
        shop: 1,
        shopName: 1,
        attemptStats: 1,
        subscriptionStats: 1,
        refundStats: 1,
        attention: 1,
      },
    },
  ]);
  if (!order) throw fail(404, "ADMIN_ORDER_NOT_FOUND", "Payment order is no longer available");
  return order;
}
export async function paymentOrderRecords(id, f) {
  const order = await parent(id);
  let model, pipeline, fields, sort;
  const binding = {
    orderId: order._id,
    shopId: order.shopId,
    gatewayOrderId: order.gatewayOrderId,
  };
  if (f.kind === "attempts") {
    model = PaymentTransaction;
    pipeline = [
      { $match: { ...binding, ...legacyMode(), currency: order.currency } },
    ];
    fields = attemptProjection;
    sort = "createdAt";
  }
  if (f.kind === "refunds") {
    model = PaymentRefund;
    pipeline = [{ $match: { ...binding, ...mode() } }];
    fields = refundProjection;
    sort = "createdAt";
  }
  if (f.kind === "subscriptions") {
    model = ShopSubscription;
    pipeline = subscriptions(order._id, order.shopId);
    fields = subProjection;
    sort = "createdAt";
  }
  if (f.kind === "webhooks") {
    model = PaymentWebhookEvent;
    pipeline = [
      {
        $match: {
          ...mode(),
          orderId: order.gatewayOrderId || "__NO_PROVIDER_ORDER__",
        },
      },
    ];
    fields = webhookProjection;
    sort = "createdAt";
  }
  if (f.kind === "adminAudit") {
    model = AdminAudit;
    sort = "createdAt";
    pipeline = [{ $match: { targetType: "payment_order", targetId: id } }];
    fields = projection(
      "_id action targetType targetId result correlationId createdAt updatedAt",
    );
  }
  if (f.kind === "audit") {
    model = SubscriptionAuditLog;
    sort = "occurredAt";
    // Correlate stored references, not arbitrary shop-wide history.
    pipeline = [
      { $match: { shopId: order.shopId } },
      {
        $lookup: {
          from: PaymentTransaction.collection.name,
          let: { ref: "$referenceId" },
          pipeline: [
            {
              $match: {
                ...binding,
                ...legacyMode(),
                $expr: {
                  $in: [
                    "$$ref",
                    [
                      { $concat: ["payment:", { $toString: "$_id" }] },
                      { $concat: ["payment-review:", "$gatewayPaymentId"] },
                      { $concat: ["payment-failed:", "$gatewayPaymentId"] },
                    ],
                  ],
                },
              },
            },
            { $project: { _id: 1 } },
            { $limit: 1 },
          ],
          as: "linked",
        },
      },
      {
        $match: {
          $or: [
            { referenceId: "wallet-order:" + id },
            { "metadata.paymentOrderId": id },
            { "linked.0": { $exists: true } },
          ],
        },
      },
    ];
    fields = projection(
      "_id eventType referenceId actorType occurredAt createdAt updatedAt",
    );
  }
  const [r] = await agg(model, [
    ...pipeline,
    {
      $facet: {
        data: [
          { $sort: { [sort]: -1, _id: -1 } },
          { $skip: (f.page - 1) * f.limit },
          { $limit: f.limit },
          { $project: fields },
        ],
        count: [{ $count: "total" }],
      },
    },
  ]);
  const total = r.count[0]?.total || 0;
  return {
    data: r.data,
    pagination: {
      page: f.page,
      limit: f.limit,
      total,
      pages: Math.ceil(total / f.limit),
    },
  };
}
// Resolve only actual local parents; no inferred dk_ ID conversion or backfill.
export async function attachOrderLinks(
  rows,
  { providerReference = false } = {},
) {
  const localIds = rows
    .map((r) => r.orderId)
    .filter((v) => mongoose.isValidObjectId(v));
  const gatewayIds = providerReference
    ? rows
        .map((r) => r.orderId)
        .filter((v) => typeof v === "string" && v.length > 0)
    : [];
  const orders = await PaymentOrder.find({
    ...mode(),
    $or: [{ _id: { $in: localIds } }, { gatewayOrderId: { $in: gatewayIds } }],
  })
    .select("_id shopId gatewayOrderId")
    .maxTimeMS(5000)
    .lean();
  const byId = new Map(orders.map((o) => [String(o._id), o])),
    byGateway = new Map(
      orders.filter((o) => o.gatewayOrderId).map((o) => [o.gatewayOrderId, o]),
    );
  return rows.map((r) => {
    const o = providerReference
      ? byGateway.get(r.orderId)
      : byId.get(String(r.orderId));
    const valid =
      o &&
      (!r.shopId || String(o.shopId) === String(r.shopId)) &&
      (!r.gatewayOrderId || r.gatewayOrderId === o.gatewayOrderId);
    return { ...r, resolvedOrderId: valid ? String(o._id) : null };
  });
}
export async function paymentAttemptDetail(id) {
  const record = await PaymentTransaction.findById(id)
    .select(attemptProjection)
    .maxTimeMS(5000)
    .lean();
  if (!record)
    throw fail(404, "ADMIN_PAYMENT_NOT_FOUND", "Payment transaction not found");
  const [linked] = await attachOrderLinks([record]);
  if (
    record.appMode !== process.env.APP_MODE &&
    !(record.appMode === undefined && linked.resolvedOrderId)
  )
    throw fail(404, "ADMIN_PAYMENT_NOT_FOUND", "Payment transaction not found");
  return linked;
}
