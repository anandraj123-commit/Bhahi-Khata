import mongoose from "mongoose";
import { Customer, Entry, Shop } from "../../models.js";
import { fail } from "../utils/security.js";
import { literalSearch } from "./readModels.js";

const financialEntryMatch = (customer) => ({
  shopId: customer.shopId,
  customerClientId: customer.clientId,
  deletedAt: { $exists: false },
});

function day(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function lifecycle(customer) {
  if (
    customer.status === undefined &&
    customer.disabled === undefined &&
    customer.removed === undefined
  )
    return "active";
  if (
    customer.status === true &&
    customer.disabled === false &&
    customer.removed === false
  )
    return "active";
  if (
    customer.status === false &&
    customer.disabled === true &&
    customer.removed === false
  )
    return "disabled";
  if (
    customer.status === false &&
    customer.disabled === false &&
    customer.removed === true
  )
    return "removed";
  return "invalid";
}

async function contextFor(customerId) {
  const customer = await Customer.findOne({
    _id: new mongoose.Types.ObjectId(customerId),
    deletedAt: { $exists: false },
  })
    .select(
      "_id shopId clientId name openingPaise openingAdvancePaise openingDate createdAt updatedAt status disabled removed",
    )
    .maxTimeMS(5000)
    .lean();
  if (!customer)
    throw fail(404, "ADMIN_CUSTOMER_NOT_FOUND", "Customer not found");
  const shop = await Shop.findById(customer.shopId)
    .select("_id name")
    .maxTimeMS(5000)
    .lean();
  if (!shop)
    throw fail(404, "ADMIN_CUSTOMER_NOT_FOUND", "Customer not found");
  return { customer, shop };
}

function customerMetadata({ customer, shop }) {
  return {
    id: String(customer._id),
    customerId: customer.clientId,
    name: customer.name || "Unnamed customer",
    shopId: String(shop._id),
    shopName: shop.name || "Registered shop",
    status: lifecycle(customer),
    createdAt: customer.createdAt || null,
    updatedAt: customer.updatedAt || null,
    openingDate:
      day(customer.openingDate) || day(customer.createdAt) || null,
    openingUdhariPaise: customer.openingPaise || 0,
    openingAdvancePaise: customer.openingAdvancePaise || 0,
  };
}

function compareEventToOpening(entry, openingDate) {
  if (entry.date !== openingDate) return entry.date < openingDate ? -1 : 1;
  const recordedAt = entry.financialRecordedAt
    ? new Date(entry.financialRecordedAt).getTime()
    : Date.parse(`${entry.date}T00:00:00.000Z`);
  const openingAt = Date.parse(`${openingDate}T00:00:00.000Z`);
  if (recordedAt !== openingAt) return recordedAt < openingAt ? -1 : 1;
  return 1; // Digital-Khata places the opening event before an equal-time entry.
}

async function* chronologicalEvents(customer) {
  const openingDate = day(customer.openingDate) || day(customer.createdAt);
  const cursor = Entry.aggregate([
    { $match: financialEntryMatch(customer) },
    {
      $addFields: {
        financialRecordedAt: {
          $ifNull: [
            "$recordedAt",
            {
              $ifNull: [
                "$createdAt",
                {
                  $dateFromString: {
                    dateString: { $concat: ["$date", "T00:00:00.000Z"] },
                  },
                },
              ],
            },
          ],
        },
      },
    },
    { $sort: { date: 1, financialRecordedAt: 1, clientId: 1 } },
    {
      $project: {
        _id: 1,
        clientId: 1,
        type: 1,
        amountPaise: 1,
        date: 1,
        financialRecordedAt: 1,
      },
    },
  ])
    .allowDiskUse(true)
    .option({ maxTimeMS: 60000 })
    .cursor({ batchSize: 500 });
  let row = await cursor.next();
  let openingPending = Boolean(openingDate);
  try {
    while (row || openingPending) {
      if (openingPending && (!row || compareEventToOpening(row, openingDate) > 0)) {
        openingPending = false;
        yield { kind: "opening", date: openingDate };
      } else {
        yield { kind: "entry", ...row };
        row = await cursor.next();
      }
    }
  } finally {
    await cursor.close();
  }
}

/**
 * Read-only server projection of the mobile customerFinancialSummary() logic
 * in src/model.ts. Amounts remain integer paise; only live, non-tombstoned
 * LedgerEntry documents participate, matching getBootstrap/listLedger.
 */
export async function customerFinancialSummary(customerId) {
  const context = await contextFor(customerId);
  const { customer, shop } = context;
  const metadata = customerMetadata(context);
  const openingDate = metadata.openingDate;
  const openingUdhari = metadata.openingUdhariPaise;
  const openingAdvance = metadata.openingAdvancePaise;
  const openingNet = openingUdhari - openingAdvance;
  const openingRecovered = Math.min(openingUdhari, openingAdvance);
  let net = openingDate ? 0 : openingNet;
  let recovered = openingDate ? 0 : openingRecovered;
  let deposited = openingDate ? 0 : openingAdvance;
  let received = openingDate ? 0 : openingAdvance;
  let refunded = 0;
  let udhari = openingUdhari;

  for await (const event of chronologicalEvents(customer)) {
    if (event.kind === "opening") {
      net = openingNet;
      recovered += openingRecovered;
      deposited += openingAdvance;
      received += openingAdvance;
    } else {
      const amount = event.amountPaise;
      if (event.type === "credit") {
        net += amount;
        udhari += amount;
      } else if (event.type === "payment") {
        const applied = Math.min(Math.max(0, net), amount);
        recovered += applied;
        deposited += amount - applied;
        received += amount;
        net -= amount;
      } else if (event.type === "refund") {
        refunded += amount;
        net += amount;
      }
    }
  }

  const latest = await Entry.findOne({
    ...financialEntryMatch(customer),
  })
    .select("date recordedAt createdAt")
    .sort({ date: -1, _id: -1 })
    .maxTimeMS(5000)
    .lean();
  const lastActivityAt = latest
    ? latest.recordedAt || latest.createdAt || latest.date
    : openingDate;
  return {
    customer: {
      id: metadata.id,
      customerId: metadata.customerId,
      name: metadata.name,
      shopId: metadata.shopId,
      shopName: metadata.shopName,
      status: metadata.status,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      openingDate,
      lastActivityAt,
    },
    openingBalancePaise: openingNet,
    openingUdhariPaise: openingUdhari,
    openingAdvancePaise: openingAdvance,
    currentNetBalancePaise: net,
    outstandingPaise: Math.max(0, net),
    availableAdvancePaise: Math.max(0, -net),
    totalUdhariPaise: udhari,
    totalReceivedPaise: received,
    totalUdhariRecoveredPaise: recovered,
    totalAdvanceDepositedPaise: deposited,
    totalAdvanceRefundedPaise: refunded,
  };
}

function openingHistory(customer) {
  const date = day(customer.openingDate) || day(customer.createdAt);
  if (!date) return [];
  const udhari = customer.openingPaise || 0;
  const advance = customer.openingAdvancePaise || 0;
  const rows = [];
  if (udhari > 0)
    rows.push({
      id: `opening-udhari:${customer.clientId}`,
      type: "opening",
      label: "Opening Udhari",
      amountPaise: udhari,
      balanceEffectPaise: udhari,
      date,
      status: "opening_record",
    });
  if (advance > 0)
    rows.push({
      id: `opening-advance:${customer.clientId}`,
      type: "opening",
      label: "Opening Advance",
      amountPaise: advance,
      balanceEffectPaise: -advance,
      date,
      status: "opening_record",
    });
  if (udhari > 0 && advance > 0)
    rows.push({
      id: `opening-adjustment:${customer.clientId}`,
      type: "opening",
      label: "Opening advance applied to Udhari",
      amountPaise: Math.min(udhari, advance),
      balanceEffectPaise: 0,
      date,
      status: "opening_adjustment",
      note: `Remaining advance: ${Math.max(0, advance - udhari)} paise`,
    });
  return rows;
}

function transactionStatus(entry) {
  if (entry.deletedAt) return "voided";
  return (entry.resolutionVersion || 1) > 1 ? "conflict_resolved" : "recorded";
}

function transactionOut(entry) {
  const status = transactionStatus(entry);
  const balanceEffectPaise =
    status === "voided"
      ? null
      : entry.type === "payment"
        ? -entry.amountPaise
        : entry.amountPaise;
  return {
    id: entry.clientId,
    customerId: entry.customerClientId,
    type: entry.type,
    amountPaise: entry.amountPaise,
    balanceEffectPaise,
    direction:
      balanceEffectPaise == null
        ? null
        : balanceEffectPaise > 0
          ? "increases_balance"
          : "decreases_balance",
    date: entry.date,
    recordedAt: entry.recordedAt || entry.createdAt || null,
    note: entry.note || "",
    method: entry.method || "",
    reference: entry.reference || "",
    status,
    serverVersion: entry.serverVersion || 1,
    resolutionVersion: entry.resolutionVersion || 1,
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null,
  };
}

export async function customerTransactions(customerId, filters) {
  const context = await contextFor(customerId);
  const { customer } = context;
  const openingRows = openingHistory(customer);
  const filter = {
    shopId: customer.shopId,
    customerClientId: customer.clientId,
  };
  if (filters.from || filters.to) {
    filter.date = {
      ...(filters.from ? { $gte: filters.from } : {}),
      ...(filters.to ? { $lte: filters.to } : {}),
    };
  }
  if (filters.type && filters.type !== "opening") filter.type = filters.type;
  if (filters.status === "voided") filter.deletedAt = { $exists: true };
  else if (filters.status === "recorded")
    filter.$and = [
      { deletedAt: { $exists: false } },
      {
        $or: [
          { resolutionVersion: { $exists: false } },
          { resolutionVersion: { $lte: 1 } },
        ],
      },
    ];
  else if (filters.status === "conflict_resolved") {
    filter.deletedAt = { $exists: false };
    filter.resolutionVersion = { $gt: 1 };
  }
  if (filters.q) {
    const search = literalSearch(filters.q);
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { clientId: { $regex: search, $options: "i" } },
          { reference: { $regex: search, $options: "i" } },
        ],
      },
    ];
  }
  const sort =
    filters.sort === "oldest"
      ? { date: 1, _id: 1 }
      : { date: -1, _id: -1 };
  const isOpeningOnly = filters.type === "opening";
  const [rows, total] = isOpeningOnly
    ? [[], 0]
    : await Promise.all([
    Entry.find(filter)
      .select(
        "_id clientId customerClientId type amountPaise date recordedAt note method reference serverVersion resolutionVersion deletedAt createdAt updatedAt",
      )
      .sort(sort)
      .skip((filters.page - 1) * filters.limit)
      .limit(filters.limit)
      .maxTimeMS(10000)
      .lean(),
    Entry.countDocuments(filter).maxTimeMS(10000),
  ]);
  const dateMatches = (row) =>
    (!filters.from || row.date >= filters.from) &&
    (!filters.to || row.date <= filters.to);
  const includeOpening =
    (!filters.type || filters.type === "opening") &&
    !filters.status;
  const visibleOpenings = includeOpening
    ? openingRows.filter((row) =>
        dateMatches(row) &&
        (!filters.q ||
          `${row.label} ${row.id}`
            .toLowerCase()
            .includes(filters.q.toLowerCase())),
      )
    : [];
  return {
    data: rows.map(transactionOut),
    openingEntries: visibleOpenings,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      pages: Math.ceil(total / filters.limit),
    },
  };
}

function statementTotals(rows) {
  return {
    count: rows[0]?.count || 0,
    netPaise: rows[0]?.netPaise || 0,
    udhariPaise: rows[0]?.udhariPaise || 0,
    paymentPaise: rows[0]?.paymentPaise || 0,
    refundPaise: rows[0]?.refundPaise || 0,
  };
}

export async function customerStatement(customerId, period) {
  const context = await contextFor(customerId);
  const { customer } = context;
  const metadata = customerMetadata(context);
  const [facets = {}] = await Entry.aggregate([
    { $match: financialEntryMatch(customer) },
    {
      $facet: {
        before: [
          { $match: { date: { $lt: period.from } } },
          {
            $group: {
              _id: null,
              netPaise: {
                $sum: {
                  $switch: {
                    branches: [
                      {
                        case: { $eq: ["$type", "payment"] },
                        then: { $multiply: ["$amountPaise", -1] },
                      },
                    ],
                    default: "$amountPaise",
                  },
                },
              },
            },
          },
        ],
        period: [
          { $match: { date: { $gte: period.from, $lte: period.to } } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              netPaise: {
                $sum: {
                  $switch: {
                    branches: [
                      {
                        case: { $eq: ["$type", "payment"] },
                        then: { $multiply: ["$amountPaise", -1] },
                      },
                    ],
                    default: "$amountPaise",
                  },
                },
              },
              udhariPaise: {
                $sum: {
                  $cond: [{ $eq: ["$type", "credit"] }, "$amountPaise", 0],
                },
              },
              paymentPaise: {
                $sum: {
                  $cond: [{ $eq: ["$type", "payment"] }, "$amountPaise", 0],
                },
              },
              refundPaise: {
                $sum: {
                  $cond: [{ $eq: ["$type", "refund"] }, "$amountPaise", 0],
                },
              },
            },
          },
        ],
      },
    },
  ])
    .allowDiskUse(true)
    .option({ maxTimeMS: 15000 });
  const before = statementTotals(facets.before || []);
  const within = statementTotals(facets.period || []);
  const openingDate = metadata.openingDate;
  const openingNet = metadata.openingUdhariPaise - metadata.openingAdvancePaise;
  const openingIsInPeriod =
    openingDate && openingDate >= period.from && openingDate <= period.to;
  const carriedOpening =
    !openingDate || openingDate < period.from ? openingNet : 0;
  const openingBalancePaise = carriedOpening + before.netPaise;
  const closingBalancePaise =
    openingBalancePaise +
    within.netPaise +
    (openingIsInPeriod ? openingNet : 0);
  const totalUdhariPaise =
    within.udhariPaise +
    (openingIsInPeriod ? metadata.openingUdhariPaise : 0);
  const totalMoneyReceivedPaise =
    within.paymentPaise +
    (openingIsInPeriod ? metadata.openingAdvancePaise : 0);
  const totalAdvanceRefundedPaise = within.refundPaise;
  return {
    customerId: metadata.customerId,
    shopId: metadata.shopId,
    period: { from: period.from, to: period.to },
    openingBalancePaise,
    openingBalanceDate: period.from,
    closingBalancePaise,
    closingBalanceDate: period.to,
    transactionCount: within.count,
    totalDebitPaise: null,
    totalCreditPaise: null,
    debitCreditAvailable: false,
    totalUdhariPaise,
    totalMoneyReceivedPaise,
    totalAdvanceRefundedPaise,
    summary:
      `Opening balance ${openingBalancePaise} paise; ` +
      `${within.count} transactions; closing balance ${closingBalancePaise} paise.`,
  };
}
