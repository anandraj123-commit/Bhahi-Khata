import mongoose from "mongoose";
import { Entry, Shop } from "../../models.js";
import { chronology } from "./shopFinancials.js";
import { customerFinancialSummary } from "./customerFinancials.js";
import { fail } from "../utils/security.js";
const literal = (v) => ({
  $regex: v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  $options: "i",
});
const metrics = [
  "udhari",
  "received",
  "recovered",
  "deposited",
  "refunded",
  "used",
];
const sums = () =>
  Object.fromEntries(metrics.map((k) => [k, { $sum: "$" + k }]));
const projection = {
  clientId: 1,
  shopId: 1,
  shop: 1,
  customerMongoId: 1,
  customerId: 1,
  name: 1,
  phone: 1,
  address: 1,
  customerStatus: 1,
  archived: 1,
  type: 1,
  amountPaise: 1,
  date: 1,
  createdAt: 1,
  updatedAt: 1,
  recordedAt: 1,
  method: 1,
  note: 1,
  reference: 1,
  serverVersion: 1,
  resolutionVersion: 1,
  transactionStatus: 1,
  previousBalance: 1,
  balance: 1,
  ...Object.fromEntries(metrics.map((k) => [k, 1])),
};
function joinShop() {
  return [
    {
      $lookup: {
        from: Shop.collection.name,
        localField: "shopId",
        foreignField: "_id",
        pipeline: [{ $project: { name: 1, owner: 1, phone: 1, address: 1 } }],
        as: "shop",
      },
    },
    { $unwind: "$shop" },
  ];
}
function postFilters(f) {
  const m = { opening: false };
  if (f.q) {
    m.$or = [
      "clientId",
      "name",
      "phone",
      "address",
      "customerId",
      "note",
      "shop.name",
      "shop.phone",
    ].map((k) => ({ [k]: literal(f.q) }));
    if (/^[a-f\d]{24}$/i.test(f.q))
      m.$or.push(
        { shopId: new mongoose.Types.ObjectId(f.q) },
        { _id: new mongoose.Types.ObjectId(f.q) },
      );
  }
  if (f.shopName) m["shop.name"] = literal(f.shopName);
  if (f.shopPhone) m["shop.phone"] = literal(f.shopPhone);
  if (f.clientId) m.clientId = f.clientId;
  if (f.method) m.method = f.method;
  for (const k of ["type", "transactionStatus"]) if (f[k]) m[k] = f[k];
  if (f.hasNotes)
    m.note = f.hasNotes === "true" ? { $regex: /\S/ } : { $not: /\S/ };
  if (f.edited)
    m.serverVersion = f.edited === "true" ? { $gt: 1 } : { $lte: 1 };
  if (f.amountMin !== undefined || f.amountMax !== undefined)
    m.amountPaise = {
      ...(f.amountMin !== undefined
        ? { $gte: Math.round(f.amountMin * 100) }
        : {}),
      ...(f.amountMax !== undefined
        ? { $lte: Math.round(f.amountMax * 100) }
        : {}),
    };
  for (const k of ["date", "createdAt", "updatedAt"]) {
    const from = f[k + "From"],
      to = f[k + "To"];
    if (from || to)
      m[k] = {
        ...(from
          ? { $gte: k === "date" ? from : new Date(from + "T00:00:00.000Z") }
          : {}),
        ...(to
          ? k === "date"
            ? { $lte: to }
            : { $lt: new Date(Date.parse(to + "T00:00:00.000Z") + 86400000) }
          : {}),
      };
  }
  return m;
}
export async function globalTransactions(f) {
  const shopId = f.shopId ? new mongoose.Types.ObjectId(f.shopId) : null;
  if (shopId && !(await Shop.exists({ _id: shopId })))
    throw fail(404, "ADMIN_SHOP_NOT_FOUND", "Shop not found");
  const shopMatch = {};
  if (f.shopName) shopMatch["shop.name"] = literal(f.shopName);
  if (f.shopPhone) shopMatch["shop.phone"] = literal(f.shopPhone);
  const pipeline = chronology(shopId, f, [
    ...joinShop(),
    { $match: shopMatch },
  ]);
  // Opening contributions are reported separately; they are not fabricated ledger transactions.
  const openingMatch = postFilters(f);
  delete openingMatch.opening;
  const hasTransactionFilters = [
    "q",
    "clientId",
    "method",
    "type",
    "transactionStatus",
    "hasNotes",
    "edited",
    "amountMin",
    "amountMax",
    "dateFrom",
    "dateTo",
    "createdAtFrom",
    "createdAtTo",
    "updatedAtFrom",
    "updatedAtTo",
  ].some((k) => f[k] !== undefined);
  pipeline.push({
    $facet: {
      rows: [
        { $match: postFilters(f) },
        {
          $sort: {
            [f.sort]: f.direction === "asc" ? 1 : -1,
            ...(f.sort === "date"
              ? { clock: f.direction === "asc" ? 1 : -1 }
              : {}),
            _id: 1,
          },
        },
        { $skip: (f.page - 1) * f.limit },
        { $limit: f.limit },
        { $project: projection },
      ],
      summary: [
        { $match: postFilters(f) },
        { $group: { _id: null, total: { $sum: 1 }, ...sums() } },
      ],
      opening: hasTransactionFilters
        ? [{ $match: { _id: null } }]
        : [
            { $match: { ...openingMatch, opening: true } },
            { $group: { _id: null, ...sums() } },
          ],
    },
  });
  const [result] = await Entry.aggregate(pipeline)
    .allowDiskUse(true)
    .option({ maxTimeMS: 10000 });
  return {
    rows: result.rows || [],
    summary: result.summary[0] || {
      total: 0,
      ...Object.fromEntries(metrics.map((k) => [k, 0])),
    },
    opening: hasTransactionFilters
      ? null
      : result.opening[0] || Object.fromEntries(metrics.map((k) => [k, 0])),
    page: f.page,
    limit: f.limit,
  };
}
export async function transactionDetail(id) {
  const entry = await Entry.findOne({
    _id: new mongoose.Types.ObjectId(id),
    deletedAt: { $exists: false },
  })
    .select("shopId customerClientId")
    .maxTimeMS(5000)
    .lean();
  if (!entry)
    throw fail(404, "ADMIN_TRANSACTION_NOT_FOUND", "Transaction not found");
  const [row] = await Entry.aggregate([
    ...chronology(entry.shopId, { exactCustomerId: entry.customerClientId }),
    { $match: { _id: new mongoose.Types.ObjectId(id), opening: false } },
    ...joinShop(),
    { $project: projection },
  ])
    .allowDiskUse(true)
    .option({ maxTimeMS: 10000 });
  if (!row)
    throw fail(
      404,
      "ADMIN_TRANSACTION_NOT_FOUND",
      "Transaction, customer or shop is no longer available",
    );
  const financial = await customerFinancialSummary(String(row.customerMongoId));
  return { transaction: row, currentCustomer: financial };
}
