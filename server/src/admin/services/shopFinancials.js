import mongoose from "mongoose";
import { Customer, Entry, Shop } from "../../models.js";
import { fail } from "../utils/security.js";

// Same integer-paise chronology as src/model.ts customerFinancialSummary.
// Window sums avoid retaining complete customer ledgers in arrays or Node memory.
const zero = (field) => ({ $ifNull: [field, 0] });
const positive = (value) => ({ $max: [0, value] });
const minimum = (a, b) => ({ $min: [a, b] });
const day = (value) => ({
  $dateToString: {
    date: value,
    format: "%Y-%m-%d",
    timezone: "UTC",
    onNull: "",
  },
});
const fields = [
  "udhari",
  "received",
  "recovered",
  "deposited",
  "refunded",
  "used",
];
const live = { deletedAt: { $exists: false } };
const sumFields = () =>
  Object.fromEntries(fields.map((k) => [k, { $sum: `$${k}` }]));
export const customerViews = new Set([
  "customers",
  "outstanding",
  "availableAdvance",
]);
function chronology(shopId, filters = {}) {
  return [
    {
      $match: {
        shopId,
        ...live,
        ...(filters.exactCustomerId
          ? { customerClientId: filters.exactCustomerId }
          : {}),
      },
    },
    {
      $project: {
        clientId: 1,
        customerClientId: 1,
        type: 1,
        amountPaise: 1,
        date: 1,
        recordedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        method: 1,
        note: 1,
        resolutionVersion: 1,
      },
    },
    {
      $unionWith: {
        coll: Customer.collection.name,
        pipeline: [
          {
            $match: {
              shopId,
              ...live,
              ...(filters.exactCustomerId
                ? { clientId: filters.exactCustomerId }
                : {}),
            },
          },
          {
            $project: {
              customerClientId: "$clientId",
              clientId: { $concat: ["opening:", "$clientId"] },
              type: { $literal: "opening" },
              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: Customer.collection.name,
        localField: "customerClientId",
        foreignField: "clientId",
        pipeline: [
          { $match: { shopId, ...live } },
          {
            $project: {
              clientId: 1,
              name: 1,
              phone: 1,
              phoneNormalized: 1,
              address: 1,
              openingDate: 1,
              openingPaise: 1,
              openingAdvancePaise: 1,
              createdAt: 1,
              updatedAt: 1,
              status: 1,
              disabled: 1,
              removed: 1,
              subscriptionArchived: 1,
            },
          },
        ],
        as: "customer",
      },
    },
    { $unwind: "$customer" },
    {
      $set: {
        opening: { $eq: ["$type", "opening"] },
        openingDay: day({
          $ifNull: ["$customer.openingDate", "$customer.createdAt"],
        }),
        openingNet: {
          $subtract: [
            zero("$customer.openingPaise"),
            zero("$customer.openingAdvancePaise"),
          ],
        },
      },
    },
    {
      $set: {
        date: { $cond: ["$opening", "$openingDay", "$date"] },
        name: "$customer.name",
        phone: {
          $cond: [
            {
              $gt: [
                { $strLenCP: { $ifNull: ["$customer.phoneNormalized", ""] } },
                0,
              ],
            },
            "$customer.phoneNormalized",
            "$customer.phone",
          ],
        },
        address: "$customer.address",
        customerId: "$customer.clientId",
        customerMongoId: "$customer._id",
        customerStatus: {
          $switch: {
            branches: [
              {
                case: {
                  $and: ["status", "disabled", "removed"].map((k) => ({
                    $eq: [{ $type: `$customer.${k}` }, "missing"],
                  })),
                },
                then: "active",
              },
              ...[
                ["active", true, false, false],
                ["disabled", false, true, false],
                ["removed", false, false, true],
              ].map(([then, status, disabled, removed]) => ({
                case: {
                  $and: [
                    { $eq: ["$customer.status", status] },
                    { $eq: ["$customer.disabled", disabled] },
                    { $eq: ["$customer.removed", removed] },
                  ],
                },
                then,
              })),
            ],
            default: "invalid",
          },
        },
        archived: { $eq: ["$customer.subscriptionArchived", true] },
        transactionStatus: {
          $cond: [
            "$opening",
            "opening",
            {
              $cond: [
                { $gt: ["$resolutionVersion", 1] },
                "conflict_resolved",
                "recorded",
              ],
            },
          ],
        },
      },
    },
    // Customer-only predicates may run before chronology without dropping entries
    // that are necessary to calculate receipt allocations and running balances.
    {
      $match: matchFilters(
        Object.fromEntries(
          Object.entries(filters).filter(([key]) =>
            [
              "name",
              "phone",
              "address",
              "customerId",
              "exactCustomerId",
              "customerStatus",
              "archived",
            ].includes(key),
          ),
        ),
      ),
    },
    {
      $set: {
        clock: {
          $cond: [
            "$opening",
            { $concat: ["$date", "T00:00:00.000Z"] },
            {
              $dateToString: {
                date: { $ifNull: ["$recordedAt", "$createdAt"] },
                format: "%Y-%m-%dT%H:%M:%S.%LZ",
                onNull: { $concat: ["$date", "T00:00:00.000Z"] },
              },
            },
          ],
        },
        openingOrder: { $cond: ["$opening", 0, 1] },
        delta: {
          $cond: [
            "$opening",
            "$openingNet",
            {
              $cond: [
                { $eq: ["$type", "payment"] },
                { $multiply: [-1, "$amountPaise"] },
                "$amountPaise",
              ],
            },
          ],
        },
      },
    },
    {
      $set: {
        segment: {
          $cond: [
            {
              $or: [
                { $lt: ["$date", "$openingDay"] },
                {
                  $and: [
                    { $eq: ["$date", "$openingDay"] },
                    {
                      $lt: [
                        "$clock",
                        { $concat: ["$openingDay", "T00:00:00.000Z"] },
                      ],
                    },
                  ],
                },
              ],
            },
            0,
            1,
          ],
        },
      },
    },
    {
      $setWindowFields: {
        partitionBy: { customer: "$customerClientId", segment: "$segment" },
        sortBy: { date: 1, clock: 1, openingOrder: 1, clientId: 1 },
        output: {
          balance: {
            $sum: "$delta",
            window: { documents: ["unbounded", "current"] },
          },
        },
      },
    },
    {
      $set: {
        previousBalance: {
          $cond: ["$opening", null, { $subtract: ["$balance", "$delta"] }],
        },
      },
    },
    {
      $set: {
        udhari: {
          $cond: [
            "$opening",
            zero("$customer.openingPaise"),
            { $cond: [{ $eq: ["$type", "credit"] }, "$amountPaise", 0] },
          ],
        },
        received: {
          $cond: [
            "$opening",
            zero("$customer.openingAdvancePaise"),
            { $cond: [{ $eq: ["$type", "payment"] }, "$amountPaise", 0] },
          ],
        },
        recovered: {
          $cond: [
            "$opening",
            minimum(
              zero("$customer.openingPaise"),
              zero("$customer.openingAdvancePaise"),
            ),
            {
              $cond: [
                { $eq: ["$type", "payment"] },
                minimum(positive("$previousBalance"), "$amountPaise"),
                0,
              ],
            },
          ],
        },
        refunded: { $cond: [{ $eq: ["$type", "refund"] }, "$amountPaise", 0] },
        used: {
          $cond: [
            { $eq: ["$type", "credit"] },
            minimum(
              positive({ $multiply: [-1, "$previousBalance"] }),
              "$amountPaise",
            ),
            0,
          ],
        },
      },
    },
    {
      $set: {
        deposited: {
          $cond: [
            "$opening",
            "$received",
            { $subtract: ["$received", "$recovered"] },
          ],
        },
      },
    },
  ];
}
function customers() {
  return [
    {
      $sort: {
        customerClientId: 1,
        date: 1,
        clock: 1,
        openingOrder: 1,
        clientId: 1,
      },
    },
    {
      $group: {
        _id: "$customerClientId",
        row: { $last: "$$ROOT" },
        balance: { $last: "$balance" },
        ...sumFields(),
        recent: { $sum: { $cond: ["$opening", 0, 1] } },
        lastTransaction: { $max: { $cond: ["$opening", null, "$date"] } },
        lastAdvanceActivity: {
          $max: {
            $cond: [
              { $gt: [{ $add: ["$deposited", "$refunded", "$used"] }, 0] },
              "$date",
              null,
            ],
          },
        },
      },
    },
    {
      $replaceWith: {
        $mergeObjects: [
          "$row",
          "$$ROOT",
          {
            clientId: "$_id",
            createdAt: "$row.customer.createdAt",
            updatedAt: "$row.customer.updatedAt",
            date: "$lastTransaction",
          },
        ],
      },
    },
    { $unset: ["row", "customer"] },
    {
      $set: {
        outstanding: positive("$balance"),
        availableAdvance: positive({ $multiply: [-1, "$balance"] }),
      },
    },
  ];
}
const literal = (value) => ({
  $regex: value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  $options: "i",
});
function matchFilters(f) {
  const match = {};
  if (f.exactCustomerId) match.customerId = f.exactCustomerId;
  for (const k of [
    "name",
    "phone",
    "address",
    "customerId",
    "clientId",
    "method",
  ])
    if (f[k] && !(k === "customerId" && f.exactCustomerId))
      match[k] = literal(f[k]);
  if (f.q)
    match.$or = ["name", "phone", "address", "customerId", "clientId"].map(
      (k) => ({ [k]: literal(f.q) }),
    );
  for (const k of ["customerStatus", "type", "transactionStatus"])
    if (f[k]) match[k] = f[k];
  if (f.archived) match.archived = f.archived === "true";
  for (const k of ["date", "createdAt", "updatedAt"]) {
    const from = f[`${k}From`],
      to = f[`${k}To`];
    if (from || to)
      match[k] = {
        ...(from
          ? { $gte: k === "date" ? from : new Date(`${from}T00:00:00.000Z`) }
          : {}),
        ...(to
          ? k === "date"
            ? { $lte: to }
            : { $lt: new Date(Date.parse(`${to}T00:00:00.000Z`) + 86400000) }
          : {}),
      };
  }
  for (const k of ["amount", "outstanding", "availableAdvance"]) {
    const range = {};
    if (f[`${k}Min`] !== undefined) range.$gte = Math.round(f[`${k}Min`] * 100);
    if (f[`${k}Max`] !== undefined) range.$lte = Math.round(f[`${k}Max`] * 100);
    if (f[`${k}Positive`] === "true") range.$gt = 0;
    if (Object.keys(range).length) match[k] = range;
  }
  return match;
}
const output = {
  _id: 0,
  clientId: 1,
  customerId: 1,
  customerMongoId: 1,
  name: 1,
  phone: 1,
  address: 1,
  customerStatus: 1,
  archived: 1,
  type: 1,
  amount: 1,
  amountPaise: 1,
  previousBalance: 1,
  balance: 1,
  method: 1,
  note: 1,
  date: 1,
  createdAt: 1,
  updatedAt: 1,
  transactionStatus: 1,
  outstanding: 1,
  availableAdvance: 1,
  lastTransaction: 1,
  lastAdvanceActivity: 1,
  ...Object.fromEntries(fields.map((k) => [k, 1])),
};
export async function shopFinancials(id, f = null) {
  const shopId = new mongoose.Types.ObjectId(id);
  const shop = await Shop.findById(shopId).select("name").lean();
  if (!shop) throw fail(404, "ADMIN_SHOP_NOT_FOUND", "Shop not found");
  let pipeline = chronology(shopId, f || {});
  if (!f) {
    pipeline.push(...customers(), {
      $group: {
        _id: null,
        ...sumFields(),
        recent: { $sum: "$recent" },
        customers: { $sum: 1 },
        outstanding: { $sum: { $cond: [{ $gt: ["$outstanding", 0] }, 1, 0] } },
        outstandingAmount: { $sum: "$outstanding" },
        availableAdvance: { $sum: "$availableAdvance" },
      },
    });
    const [totals] = await Entry.aggregate(pipeline)
      .allowDiskUse(true)
      .option({ maxTimeMS: 10000 });
    return {
      shop: { id, name: shop.name },
      totals:
        totals ||
        Object.fromEntries(
          [
            ...fields,
            "recent",
            "customers",
            "outstanding",
            "outstandingAmount",
            "availableAdvance",
          ].map((k) => [k, 0]),
        ),
    };
  }
  const customerView = customerViews.has(f.view);
  if (customerView) {
    pipeline.push(...customers());
    if (f.view !== "customers")
      pipeline.push({ $match: { [f.view]: { $gt: 0 } } });
    pipeline.push({
      $set: {
        amount:
          f.view === "availableAdvance" ? "$availableAdvance" : "$outstanding",
      },
    });
  } else {
    if (f.view === "recent") pipeline.push({ $match: { opening: false } });
    else pipeline.push({ $match: { [f.view]: { $gt: 0 } } });
    pipeline.push({
      $set: { amount: f.view === "recent" ? "$amountPaise" : `$${f.view}` },
    });
  }
  pipeline.push(
    { $match: matchFilters(f) },
    {
      $facet: {
        rows: [
          {
            $sort: {
              [f.sort || (customerView ? "name" : "date")]:
                f.direction === "asc" ? 1 : -1,
              ...(!customerView && (!f.sort || f.sort === "date")
                ? { clock: f.direction === "asc" ? 1 : -1 }
                : {}),
              clientId: 1,
              customerId: 1,
            },
          },
          { $skip: (f.page - 1) * f.limit },
          { $limit: f.limit },
          { $project: output },
        ],
        summary: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              amount: { $sum: "$amount" },
            },
          },
        ],
      },
    },
  );
  const [result] = await Entry.aggregate(pipeline)
    .allowDiskUse(true)
    .option({ maxTimeMS: 10000 });
  return {
    shop: { id, name: shop.name },
    rows: result.rows,
    total: result.summary[0]?.total || 0,
    amount: result.summary[0]?.amount || 0,
    page: f.page,
    limit: f.limit,
  };
}
