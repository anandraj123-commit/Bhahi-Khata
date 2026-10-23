import mongoose from "mongoose";
import { Customer, Shop } from "../../models.js";
import { fail } from "../utils/security.js";

const literalSearch = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lifecycleExpression = {
  $switch: {
    branches: [
      {
        case: {
          $and: [
            { $eq: [{ $type: "$status" }, "missing"] },
            { $eq: [{ $type: "$disabled" }, "missing"] },
            { $eq: [{ $type: "$removed" }, "missing"] },
          ],
        },
        then: "active",
      },
      {
        case: {
          $and: [
            { $eq: ["$status", true] },
            { $eq: ["$disabled", false] },
            { $eq: ["$removed", false] },
          ],
        },
        then: "active",
      },
      {
        case: {
          $and: [
            { $eq: ["$status", false] },
            { $eq: ["$disabled", true] },
            { $eq: ["$removed", false] },
          ],
        },
        then: "disabled",
      },
      {
        case: {
          $and: [
            { $eq: ["$status", false] },
            { $eq: ["$disabled", false] },
            { $eq: ["$removed", true] },
          ],
        },
        then: "removed",
      },
    ],
    default: "invalid",
  },
};
const lifecycleMatch = {
  active: {
    $or: [
      { status: true, disabled: false, removed: false },
      {
        status: { $exists: false },
        disabled: { $exists: false },
        removed: { $exists: false },
      },
    ],
  },
  disabled: { status: false, disabled: true, removed: false },
  removed: { status: false, disabled: false, removed: true },
};
const customerProjection = {
  _id: { $toString: "$_id" },
  customerId: "$clientId",
  name: 1,
  shopId: { $toString: "$shopId" },
  shopName: "$shop.name",
  status: "$lifecycleStatus",
  createdAt: 1,
  updatedAt: 1,
};

function registrationRange(filters) {
  const createdAt = {};
  if (filters.from) createdAt.$gte = new Date(filters.from);
  if (filters.to)
    createdAt.$lt = new Date(Date.parse(filters.to) + 86400000);
  return Object.keys(createdAt).length ? { createdAt } : {};
}

function requestedMatch(filters) {
  const and = [];
  if (filters.status) and.push(lifecycleMatch[filters.status]);
  if (filters.q) {
    const query = literalSearch(filters.q);
    const alternatives = [
      { nameFolded: { $regex: `^${literalSearch(filters.q.toLowerCase())}` } },
      { clientId: { $regex: `^${query}`, $options: "i" } },
      { "shop.name": { $regex: `^${query}`, $options: "i" } },
    ];
    if (mongoose.isValidObjectId(filters.q))
      alternatives.push({ _id: new mongoose.Types.ObjectId(filters.q) });
    and.push({ $or: alternatives });
  }
  return and.length ? { $and: and } : {};
}

function countsFor(rows) {
  const counts = { total: 0, active: 0, disabled: 0, removed: 0 };
  for (const row of rows) {
    if (row._id in counts) counts[row._id] = row.count;
    counts.total += row.count;
  }
  return counts;
}

async function registeredShop(id) {
  const shop = await Shop.findById(id).select("_id").maxTimeMS(5000).lean();
  if (!shop) throw fail(404, "ADMIN_SHOP_NOT_FOUND", "Shop not found");
  return shop._id;
}

export const customerAdminIndexes = [
  [{ createdAt: -1, _id: -1 }, { name: "admin_customer_created" }],
  [
    { shopId: 1, createdAt: -1, _id: -1 },
    { name: "admin_customer_shop_created" },
  ],
  [{ clientId: 1, _id: 1 }, { name: "admin_customer_client_id" }],
];

export async function listCustomers(filters, forcedShopId) {
  const shopId = forcedShopId || filters.shopId;
  if (shopId) await registeredShop(shopId);
  const baseMatch = {
    deletedAt: { $exists: false },
    ...registrationRange(filters),
    ...(shopId ? { shopId: new mongoose.Types.ObjectId(shopId) } : {}),
  };
  const requested = requestedMatch(filters);
  const result = await Customer.aggregate([
    { $match: baseMatch },
    {
      $lookup: {
        from: Shop.collection.name,
        localField: "shopId",
        foreignField: "_id",
        pipeline: [{ $project: { _id: 1, name: 1 } }],
        as: "shop",
      },
    },
    { $unwind: "$shop" },
    { $addFields: { lifecycleStatus: lifecycleExpression } },
    {
      $facet: {
        data: [
          ...(Object.keys(requested).length ? [{ $match: requested }] : []),
          {
            $sort:
              filters.sort === "name"
                ? { nameFolded: 1, _id: 1 }
                : {
                    createdAt: filters.sort === "oldest" ? 1 : -1,
                    _id: filters.sort === "oldest" ? 1 : -1,
                  },
          },
          { $skip: (filters.page - 1) * filters.limit },
          { $limit: filters.limit },
          { $project: customerProjection },
        ],
        total: [
          ...(Object.keys(requested).length ? [{ $match: requested }] : []),
          { $count: "count" },
        ],
        summary: [
          { $group: { _id: "$lifecycleStatus", count: { $sum: 1 } } },
        ],
      },
    },
  ])
    .option({ maxTimeMS: 10000 })
    .exec();
  const page = result[0];
  return {
    data: page?.data || [],
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: page?.total[0]?.count || 0,
      pages: Math.ceil((page?.total[0]?.count || 0) / filters.limit),
    },
    summary: countsFor(page?.summary || []),
  };
}

export async function customerDetail(id) {
  const rows = await Customer.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
        deletedAt: { $exists: false },
      },
    },
    {
      $lookup: {
        from: Shop.collection.name,
        localField: "shopId",
        foreignField: "_id",
        pipeline: [{ $project: { _id: 1, name: 1 } }],
        as: "shop",
      },
    },
    { $unwind: "$shop" },
    { $addFields: { lifecycleStatus: lifecycleExpression } },
    { $project: customerProjection },
  ])
    .option({ maxTimeMS: 5000 })
    .exec();
  if (!rows.length)
    throw fail(404, "ADMIN_CUSTOMER_NOT_FOUND", "Customer not found");
  return rows[0];
}

export async function customerShopOptions(filters) {
  const query = filters.q
    ? { name: { $regex: literalSearch(filters.q), $options: "i" } }
    : {};
  const [rows, total] = await Promise.all([
    Shop.find(query)
      .select("name")
      .sort({ name: 1, _id: 1 })
      .skip((filters.page - 1) * filters.limit)
      .limit(filters.limit)
      .maxTimeMS(5000)
      .lean(),
    Shop.countDocuments(query).maxTimeMS(5000),
  ]);
  return {
    data: rows.map((shop) => ({ id: String(shop._id), name: shop.name })),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      pages: Math.ceil(total / filters.limit),
    },
  };
}
