// Read-only stored evidence. Never invoke provider verification or lifecycle services here.
import mongoose from "mongoose";
import {
  PaymentOrder,
  PaymentTransaction,
  PaymentWebhookEvent,
  PaymentOrderRecovery,
  PaymentRefund,
  Shop,
} from "../../models.js";
import { fail } from "../utils/security.js";
const fields = (s) => Object.fromEntries(s.split(" ").map((k) => [k, 1]));
const definitions = {
  attempts: {
    model: PaymentTransaction,
    statuses: [
      "captured",
      "failed",
      "refunded",
      "partially_refunded",
      "pending",
    ],
    search: ["gatewayOrderId", "gatewayPaymentId"],
    fields:
      "orderId shopId appMode provider gatewayOrderId gatewayPaymentId amountMinor currency method status verificationStatus reviewStatus reviewReason refundedAmountMinor gatewayCreatedAt gatewayStatus verifiedAt createdAt updatedAt",
  },
  webhooks: {
    model: PaymentWebhookEvent,
    statuses: ["received", "processed", "failed"],
    search: ["eventId", "orderId", "paymentId", "refundId"],
    fields:
      "eventId eventType appMode orderId paymentId refundId status attempts nextAttemptAt lastErrorCode processedAt createdAt updatedAt",
  },
  recoveries: {
    model: PaymentOrderRecovery,
    statuses: ["parent_present", "parent_missing", "review_flagged"],
    search: ["reconciliationLastCode"],
    fields:
      "shopId appMode reconciliationNextAt reconciliationLastCode createdAt updatedAt",
  },
  refunds: {
    model: PaymentRefund,
    statuses: ["SUCCESS", "PENDING", "CANCELLED", "ONHOLD", "FAILED"],
    search: [
      "gatewayOrderId",
      "gatewayPaymentId",
      "gatewayRefundId",
      "refundId",
    ],
    fields:
      "shopId appMode orderId gatewayOrderId gatewayPaymentId gatewayRefundId refundId amountMinor currency gatewayStatus verifiedAt entitlementReviewRequired createdAt updatedAt",
  },
};
export async function paymentMonitoring(kind, f) {
  const d = definitions[kind],
    mode = process.env.APP_MODE;
  if (!mode)
    throw fail(
      503,
      "ADMIN_ENVIRONMENT_UNAVAILABLE",
      "Payment environment unavailable",
    );
  if (f.status && !d.statuses.includes(f.status))
    throw fail(400, "ADMIN_INVALID_STATUS", "Unsupported record status");
  if (f.eventType && kind !== "webhooks")
    throw fail(
      400,
      "ADMIN_INVALID_FILTER",
      "Event type applies only to webhooks",
    );
  // Historical inbox rows predate appMode and often have no order reference.
  // Include them only inside the configured, verified dedicated environment DB.
  const expectedDatabase = ["development", "testing", "production"].includes(
    mode,
  )
    ? `digital_khata_${mode}`
    : null;
  const legacyWebhookScope =
    kind === "webhooks" &&
    expectedDatabase !== null &&
    process.env.MONGODB_DB_NAME === expectedDatabase &&
    d.model.db.name === expectedDatabase;
  const environmentMatch =
    kind === "webhooks" && legacyWebhookScope
      ? { $or: [{ appMode: mode }, { appMode: { $exists: false } }] }
      : { appMode: mode };
  const match =
    kind === "attempts"
      ? { $or: [{ appMode: mode }, { appMode: { $exists: false } }] }
      : { ...environmentMatch };
  if (f.from || f.to)
    match[f.dateField] = {
      ...(f.from ? { $gte: new Date(f.from) } : {}),
      ...(f.to ? { $lt: new Date(Date.parse(f.to) + 86400000) } : {}),
    };
  if (f.status && kind !== "recoveries")
    match[kind === "refunds" ? "gatewayStatus" : "status"] = f.status;
  if (f.eventType) match.eventType = f.eventType;
  const oid = (v) => new mongoose.Types.ObjectId(v);
  if (f.q) {
    // Exact identifiers/codes, never an unrestricted regex scan over financial records.
    const search = d.search.map((k) => ({ [k]: f.q }));
    if (/^[a-f\d]{24}$/i.test(f.q)) {
      search.push({ _id: oid(f.q) });
      if (["attempts", "refunds"].includes(kind))
        search.push({ orderId: oid(f.q) });
    }
    match.$and = [{ $or: search }];
  }
  if (f.shopId && kind !== "webhooks") match.shopId = oid(f.shopId);
  const relation =
    kind === "webhooks"
      ? { $eq: ["$gatewayOrderId", "$$reference"] }
      : { $eq: ["$_id", "$$reference"] };
  const pipeline = [
    { $match: kind === "webhooks" ? environmentMatch : match },
    { $project: fields(d.fields + " _id") },
    {
      $lookup: {
        from: PaymentOrder.collection.name,
        let: {
          reference: kind === "recoveries" ? "$_id" : "$orderId",
          shop: "$shopId",
          gateway: "$gatewayOrderId",
        },
        pipeline: [
          {
            $match: {
              appMode: mode,
              $expr: {
                $and: [
                  relation,
                  ...(kind === "webhooks"
                    ? [
                        { $eq: [{ $type: "$$reference" }, "string"] },
                        { $ne: ["$$reference", ""] },
                      ]
                    : []),
                  ...(kind !== "webhooks"
                    ? [{ $eq: ["$shopId", "$$shop"] }]
                    : []),
                  ...(["attempts", "refunds"].includes(kind)
                    ? [{ $eq: ["$gatewayOrderId", "$$gateway"] }]
                    : []),
                ],
              },
            },
          },
          { $project: { _id: 1, shopId: 1 } },
          { $limit: 1 },
        ],
        as: "parent",
      },
    },
    ...(kind === "attempts"
      ? [
          {
            $match: {
              $or: [{ appMode: mode }, { "parent.0": { $exists: true } }],
            },
          },
        ]
      : []),
    {
      $set: {
        resolvedOrderId: { $ifNull: [{ $first: "$parent._id" }, null] },
        ...(kind === "webhooks"
          ? { shopId: { $first: "$parent.shopId" } }
          : {}),
        ...(kind === "recoveries"
          ? {
              parentState: {
                $cond: [
                  { $gt: [{ $size: "$parent" }, 0] },
                  "parent_present",
                  "parent_missing",
                ],
              },
            }
          : {}),
      },
    },

    ...(kind === "recoveries" && f.status
      ? [
          {
            $match:
              f.status === "review_flagged"
                ? { reconciliationLastCode: { $exists: true, $ne: "" } }
                : { parentState: f.status },
          },
        ]
      : []),
    {
      $facet: {
        ...(kind === "webhooks"
          ? {
              scope: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: 1 },
                    legacy: {
                      $sum: {
                        $cond: [
                          { $eq: [{ $type: "$appMode" }, "missing"] },
                          1,
                          0,
                        ],
                      },
                    },
                  },
                },
              ],
            }
          : {}),
        count: [
          ...(kind === "webhooks"
            ? [
                {
                  $match: {
                    ...match,
                    ...(f.shopId ? { shopId: oid(f.shopId) } : {}),
                  },
                },
              ]
            : []),
          { $count: "total" },
        ],
        data: [
          ...(kind === "webhooks"
            ? [
                {
                  $match: {
                    ...match,
                    ...(f.shopId ? { shopId: oid(f.shopId) } : {}),
                  },
                },
              ]
            : []),
          {
            $sort: {
              [f.sort]: f.direction === "asc" ? 1 : -1,
              _id: f.direction === "asc" ? 1 : -1,
            },
          },
          { $skip: (f.page - 1) * f.limit },
          { $limit: f.limit },
          {
            $lookup: {
              from: Shop.collection.name,
              localField: "shopId",
              foreignField: "_id",
              pipeline: [{ $project: { _id: 1, name: 1 } }],
              as: "shop",
            },
          },
          { $set: { shopName: { $first: "$shop.name" } } },
          ...(["webhooks", "refunds"].includes(kind)
            ? [
                {
                  $lookup: {
                    from: PaymentTransaction.collection.name,
                    let: {
                      localOrder: "$resolvedOrderId",
                      shop: "$shopId",
                      payment:
                        kind === "webhooks"
                          ? "$paymentId"
                          : "$gatewayPaymentId",
                      gateway:
                        kind === "webhooks" ? "$orderId" : "$gatewayOrderId",
                    },
                    pipeline: [
                      {
                        $match: {
                          $or: [
                            { appMode: mode },
                            { appMode: { $exists: false } },
                          ],
                          $expr: {
                            $and: [
                              { $ne: ["$$localOrder", null] },
                              { $eq: ["$orderId", "$$localOrder"] },
                              { $eq: ["$shopId", "$$shop"] },
                              { $eq: [{ $type: "$$payment" }, "string"] },
                              { $ne: ["$$payment", ""] },
                              { $eq: ["$gatewayPaymentId", "$$payment"] },
                              { $eq: ["$gatewayOrderId", "$$gateway"] },
                            ],
                          },
                        },
                      },
                      { $project: { _id: 1 } },
                      { $limit: 2 },
                    ],
                    as: "linkedAttempts",
                  },
                },
                {
                  $set: {
                    resolvedAttemptId: {
                      $cond: [
                        { $eq: [{ $size: "$linkedAttempts" }, 1] },
                        { $first: "$linkedAttempts._id" },
                        null,
                      ],
                    },
                  },
                },
              ]
            : []),
          { $project: { parent: 0, shop: 0, linkedAttempts: 0 } },
        ],
      },
    },
  ];
  let result;
  try {
    [result] = await d.model
      .aggregate(pipeline)
      .option({ maxTimeMS: 10000 })
      .allowDiskUse(true);
  } catch {
    // Distinguish query failure without leaking database addresses or payloads.
    throw fail(
      503,
      "ADMIN_PAYMENT_QUERY_FAILED",
      "Payment monitoring query failed",
    );
  }
  const total = result?.count?.[0]?.total || 0;
  return {
    data: result?.data || [],
    pagination: {
      page: f.page,
      limit: f.limit,
      total,
      pages: Math.ceil(total / f.limit),
    },
    environment: mode,
    ...(kind === "webhooks"
      ? {
          scope: {
            total: result?.scope?.[0]?.total || 0,
            legacy: result?.scope?.[0]?.legacy || 0,
            legacyIncludedFromIsolatedDatabase: legacyWebhookScope,
          },
        }
      : {}),
  };
}
