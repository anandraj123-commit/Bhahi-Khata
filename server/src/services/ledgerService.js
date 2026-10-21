import mongoose from "mongoose";
import { Customer, Entry, FinancialResolution, Idempotency } from "../models.js";
import { digest } from "../utils/hashing.js";
import { paise } from "../utils/money.js";
import { entryOut, financialAuditOut } from "../utils/serializers.js";
import { sameEntryValues } from "../utils/records.js";
import { saveAudit } from "./auditService.js";

function serviceError(message, status, details = {}) {
  return Object.assign(new Error(message), { status, ...details });
}

const entrySignedPaise = (entry) =>
  entry.type === "payment" ? -entry.amountPaise : entry.amountPaise;

async function lockCustomerFinancials(shopId, clientId, session) {
  const customer = await Customer.findOne({ shopId, clientId, deletedAt: { $exists: false } })
    .session(session).lean();
  if (!customer) throw serviceError("Customer not found", 404);
  const active = customer.status === undefined && customer.disabled === undefined && customer.removed === undefined
    ? true
    : customer.status === true && customer.disabled === false && customer.removed === false;
  if (!active) throw serviceError("This customer is disabled or removed", 409, {
    code: "CUSTOMER_NOT_ACTIVE", current: null,
  });
  const result = await Customer.updateOne(
    { shopId, clientId, deletedAt: { $exists: false }, status: { $ne: false }, disabled: { $ne: true }, removed: { $ne: true } },
    { $inc: { financialVersion: 1 } },
    { session },
  );
  if (!result.matchedCount)
    throw serviceError("Customer not found", 404);
}

async function currentNetBalancePaise(shopId, clientId, session) {
  const customer = await Customer.findOne({
    shopId,
    clientId,
    deletedAt: { $exists: false },
  }).session(session).lean();
  if (!customer) throw serviceError("Customer not found", 404);
  const entries = await Entry.find({ shopId, customerClientId: clientId, deletedAt: { $exists: false } })
    .session(session)
    .select("type amountPaise")
    .lean();
  return (customer.openingPaise || 0) - (customer.openingAdvancePaise || 0) +
    entries.reduce((sum, entry) => sum + entrySignedPaise(entry), 0);
}

/** Rebuild receipt and purchase allocations after any financial edit. */
export async function reconcileCustomerAllocations(shopId, clientId, session) {
  const customer = await Customer.findOne({
    shopId,
    clientId,
    deletedAt: { $exists: false },
  }).session(session).lean();
  if (!customer) throw serviceError("Customer not found", 404);
  const entries = await Entry.find({ shopId, customerClientId: clientId, deletedAt: { $exists: false } })
    .session(session)
    .sort({ date: 1, recordedAt: 1, createdAt: 1, _id: 1 });
  const openingDate = customer.openingDate?.toISOString?.().slice(0, 10) ||
    customer.createdAt?.toISOString?.().slice(0, 10);
  const openingNetPaise = (customer.openingPaise || 0) - (customer.openingAdvancePaise || 0);
  let netPaise = openingDate ? 0 : openingNetPaise;
  let openingApplied = !openingDate;
  const writes = [];
  for (const entry of entries) {
    if (!openingApplied && entry.date >= openingDate) {
      netPaise += openingNetPaise;
      openingApplied = true;
    }
    let appliedToUdhariPaise = 0;
    let addedToAdvancePaise = 0;
    let advanceAppliedPaise = 0;
    if (entry.type === "payment") {
      appliedToUdhariPaise = Math.min(Math.max(0, netPaise), entry.amountPaise);
      addedToAdvancePaise = entry.amountPaise - appliedToUdhariPaise;
      netPaise -= entry.amountPaise;
    } else if (entry.type === "credit") {
      advanceAppliedPaise = Math.min(Math.max(0, -netPaise), entry.amountPaise);
      netPaise += entry.amountPaise;
    } else {
      if (netPaise >= 0 || entry.amountPaise > -netPaise)
        throw serviceError("Advance refund exceeds the available customer advance", 409, {
          current: entryOut(entry),
        });
      netPaise += entry.amountPaise;
    }
    if (
      entry.appliedToUdhariPaise !== appliedToUdhariPaise ||
      entry.addedToAdvancePaise !== addedToAdvancePaise ||
      entry.advanceAppliedPaise !== advanceAppliedPaise
    ) {
      entry.appliedToUdhariPaise = appliedToUdhariPaise;
      entry.addedToAdvancePaise = addedToAdvancePaise;
      entry.advanceAppliedPaise = advanceAppliedPaise;
      writes.push(entry);
    }
  }
  if (!openingApplied) netPaise += openingNetPaise;
  for (const entry of writes) await entry.save({ session });
}

export async function listLedger({ shopId, customerId, month, cursorId, limit }) {
  const filter = { shopId, deletedAt: { $exists: false } };
  if (customerId) filter.customerClientId = String(customerId).slice(0, 80);
  if (month && /^\d{4}-\d{2}$/.test(month))
    filter.date = { $gte: `${month}-01`, $lt: `${month}-32` };
  if (cursorId) {
    const cursor = await Entry.findOne({ shopId, clientId: cursorId })
      .select("_id date")
      .lean();
    if (cursor)
      filter.$or = [
        { date: { $lt: cursor.date } },
        { date: cursor.date, _id: { $lt: cursor._id } },
      ];
  }
  const rows = await Entry.find(filter)
    .sort({ date: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const more = rows.length > limit;
  if (more) rows.pop();
  return {
    items: rows.map(entryOut),
    nextCursor: more ? rows.at(-1).clientId : null,
  };
}

export async function createLedgerEntry({ shopId, actorId, entry, audit, key }) {
  if (key && key.length > 128)
    throw serviceError("Invalid idempotency key", 400);
  const requestHash = digest(JSON.stringify(entry));
  if (key) {
    const existing = await Idempotency.findOne({ shopId, key }).lean();
    if (existing) {
      if (existing.requestHash && existing.requestHash !== requestHash)
        throw serviceError("Idempotency key was already used for another transaction", 409);
      return { status: 200, response: existing.response };
    }
  }
  const session = await mongoose.startSession();
  let response;
  let duplicate = false;
  try {
    await session.withTransaction(async () => {
      let doc = await Entry.findOne({
        shopId,
        clientId: entry.id,
      }).session(session);
      if (doc) {
        if (doc.deletedAt || !sameEntryValues(entryOut(doc), entry))
          throw serviceError("Transaction identifier already exists", 409);
        response = entryOut(doc);
        duplicate = true;
        return;
      }
      await lockCustomerFinancials(shopId, entry.customerId, session);
      if (entry.type === "refund") {
        const netPaise = await currentNetBalancePaise(shopId, entry.customerId, session);
        if (netPaise >= 0 || paise(entry.amount) > -netPaise)
          throw serviceError("Advance refund exceeds the available customer advance", 409);
      }
      doc = await Entry.findOneAndUpdate(
        { shopId, clientId: entry.id },
        {
          $set: {
            shopId,
            clientId: entry.id,
            customerClientId: entry.customerId,
            type: entry.type,
            amountPaise: paise(entry.amount),
            date: entry.date,
            recordedAt: entry.recordedAt ? new Date(entry.recordedAt) : new Date(),
            note: entry.note,
            method: entry.method,
            reference: entry.reference || "",
          },
        },
        { upsert: true, new: true, runValidators: true, session },
      );
      await reconcileCustomerAllocations(shopId, entry.customerId, session);
      doc = await Entry.findOne({ shopId, clientId: entry.id }).session(session);
      if (audit)
        await saveAudit({ shopId, actorId, session }, audit);
      response = entryOut(doc);
      if (key)
        await Idempotency.create(
          [{ shopId, key, requestHash, response }],
          { session },
        );
    });
  } catch (err) {
    if (err.code === 11000 && key) {
      const found = await Idempotency.findOne({ shopId, key }).lean();
      if (found) {
        if (found.requestHash && found.requestHash !== requestHash)
          throw serviceError("Idempotency key was already used for another transaction", 409);
        return { status: 200, response: found.response };
      }
    }
    throw err;
  } finally {
    await session.endSession();
  }
  return { status: duplicate ? 200 : 201, response };
}

export async function deleteLedgerEntry({ shopId, actorId, id, base, baseVersion, baseResolutionVersion, audit }) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const entry = await Entry.findOne({
        shopId,
        clientId: id,
      }).session(session);
      if (!entry) throw serviceError("Transaction not found", 404);
      if (entry.deletedAt) return;
      await lockCustomerFinancials(shopId, entry.customerClientId, session);
      if (
        ((base?.success && !sameEntryValues(entryOut(entry), base.data)) ||
          (baseVersion && (entry.serverVersion || 1) !== baseVersion) ||
          (baseResolutionVersion && (entry.resolutionVersion || 1) !== baseResolutionVersion))
      )
        throw serviceError("Transaction changed on another device", 409, {
          current: entryOut(entry),
          serverVersion: entry.serverVersion || 1,
          resolutionVersion: entry.resolutionVersion || 1,
        });
      entry.deletedAt = new Date();
      entry.serverVersion = (entry.serverVersion || 1) + 1;
      entry.resolutionVersion = (entry.resolutionVersion || 1) + 1;
      await entry.save({ session });
      await reconcileCustomerAllocations(shopId, entry.customerClientId, session);
      if (audit)
        await saveAudit({ shopId, actorId, session }, audit);
    });
  } finally {
    await session.endSession();
  }
}

export async function updateLedgerEntry({
  shopId,
  actorId,
  entry: value,
  base,
  baseVersion,
  baseResolutionVersion,
  audit,
}) {
  const session = await mongoose.startSession();
  let response;
  try {
    await session.withTransaction(async () => {
      const doc = await Entry.findOne({
        shopId,
        clientId: value.id,
      }).session(session);
      if (!doc) throw serviceError("Transaction not found", 404);
      const affectedCustomers = [...new Set([doc.customerClientId, value.customerId])].sort();
      for (const customerId of affectedCustomers)
        await lockCustomerFinancials(shopId, customerId, session);
      const current = entryOut(doc);
      if (doc.deletedAt)
        throw serviceError("Transaction was deleted on another device", 409, {
          current: null,
          serverVersion: doc.serverVersion || 1,
          resolutionVersion: doc.resolutionVersion || 1,
        });
      if (
        ((base?.success && !sameEntryValues(current, base.data)) ||
          (baseVersion && (doc.serverVersion || 1) !== baseVersion) ||
          (baseResolutionVersion && (doc.resolutionVersion || 1) !== baseResolutionVersion)) &&
        !sameEntryValues(current, value)
      )
        throw serviceError("Transaction changed on another device", 409, { current, resolutionVersion: doc.resolutionVersion || 1 });
      if (!sameEntryValues(current, value)) {
        doc.set({
          customerClientId: value.customerId,
          type: value.type,
          amountPaise: paise(value.amount),
          date: value.date,
          reference: value.reference || "",
          note: value.note,
          method: value.method,
        });
        doc.serverVersion = (doc.serverVersion || 1) + 1;
        doc.resolutionVersion = (doc.resolutionVersion || 1) + 1;
        await doc.save({ session });
      }
      for (const customerId of affectedCustomers)
        await reconcileCustomerAllocations(shopId, customerId, session);
      if (audit)
        await saveAudit({ shopId, actorId, session }, audit);
      const refreshed = await Entry.findOne({ shopId, clientId: value.id }).session(session);
      response = entryOut(refreshed);
    });
  } finally {
    await session.endSession();
  }
  return response;
}

export async function resolveFinancialConflict({
  shopId,
  actorId,
  transactionId,
  input,
  key,
  requestHash,
  conflictId,
}) {
  const committed = await FinancialResolution.findOne({
    shopId,
    resolutionId: input.resolutionId,
  }).lean();
  if (committed) {
    if (committed.requestHash !== requestHash)
      throw serviceError("Resolution identifier was already used for another choice", 409);
    return {
      entry: committed.selected,
      serverVersion: committed.resultingVersion,
      resolutionVersion: committed.resultingResolutionVersion || 1,
      resolutionId: input.resolutionId,
      serverAt: committed.serverAt.toISOString(),
      audit: financialAuditOut(committed),
    };
  }
  const prior = await Idempotency.findOne({ shopId, key }).lean();
  if (prior) {
    if (prior.requestHash !== requestHash)
      throw serviceError("Resolution identifier was already used for another choice", 409);
    return prior.response;
  }
  const session = await mongoose.startSession();
  let response;
  try {
    await session.withTransaction(async () => {
      const repeated = await Idempotency.findOne({ shopId, key })
        .session(session)
        .lean();
      if (repeated) {
        if (repeated.requestHash !== requestHash)
          throw serviceError("Resolution identifier was already used for another choice", 409);
        response = repeated.response;
        return;
      }
      let doc = await Entry.findOne({ shopId, clientId: transactionId }).session(
        session,
      );
      if (!doc) {
        const actualVersion = 1;
        const actualResolutionVersion = 1;
        if (input.expectedVersion !== actualVersion || input.expectedResolutionVersion !== actualResolutionVersion)
          throw serviceError("Transaction changed while the conflict was open", 409, { current: null, serverVersion: actualVersion, resolutionVersion: actualResolutionVersion });
        let selected = null;
        if (input.choice === "keep_local" && !input.localDeleted) {
          await lockCustomerFinancials(shopId, input.proposed.customerId, session);
          doc = await Entry.findOneAndUpdate(
            { shopId, clientId: transactionId },
            { $set: {
              shopId, clientId: transactionId,
              customerClientId: input.proposed.customerId,
              type: input.proposed.type,
              amountPaise: paise(input.proposed.amount),
              date: input.proposed.date,
              recordedAt: input.proposed.recordedAt ? new Date(input.proposed.recordedAt) : new Date(),
              note: input.proposed.note,
              method: input.proposed.method,
              reference: input.proposed.reference || "",
              serverVersion: 1,
              resolutionVersion: 1,
            } },
            { upsert: true, new: true, runValidators: true, session },
          );
          await reconcileCustomerAllocations(shopId, input.proposed.customerId, session);
          doc = await Entry.findOne({ shopId, clientId: transactionId }).session(session);
          selected = entryOut(doc);
        }
        const serverAt = new Date();
        const customer = await Customer.findOne({ shopId, clientId: input.proposed.customerId }).session(session).select("name").lean();
        const [record] = await FinancialResolution.create([{
          shopId, transactionId, customerName: customer?.name || "Customer",
          resolutionId: input.resolutionId, conflictId, requestHash, actorId,
          previous: input.proposed, previousMissing: true, proposed: input.proposed, selected,
          previousVersion: actualVersion, resultingVersion: selected?.serverVersion || actualVersion,
          previousResolutionVersion: actualResolutionVersion,
          resultingResolutionVersion: selected?.resolutionVersion || actualResolutionVersion,
          localAt: input.localAt ? new Date(input.localAt) : undefined,
          action: input.choice, status: "resolved", serverAt,
        }], { session });
        response = {
          entry: selected,
          serverVersion: selected?.serverVersion || actualVersion,
          resolutionVersion: selected?.resolutionVersion || actualResolutionVersion,
          resolutionId: input.resolutionId, serverAt: serverAt.toISOString(),
          audit: financialAuditOut(record),
        };
        await Idempotency.create([{ shopId, key, requestHash, response }], { session });
        return;
      }
      if (doc) {
        const affected = new Set([doc.customerClientId]);
        if (input.choice === "keep_local" && !input.localDeleted)
          affected.add(input.proposed.customerId);
        for (const customerId of [...affected].sort())
          await lockCustomerFinancials(shopId, customerId, session);
      }
      const actualVersion = doc?.serverVersion || 1;
      const actualResolutionVersion = doc?.resolutionVersion || 1;
      const current = doc && !doc.deletedAt ? entryOut(doc) : null;
      if (!doc || actualVersion !== input.expectedVersion || actualResolutionVersion !== input.expectedResolutionVersion)
        throw serviceError("Transaction changed while the conflict was open", 409, {
          current,
          serverVersion: actualVersion,
          resolutionVersion: actualResolutionVersion,
        });
      const priorConflict = await FinancialResolution.findOne({
        shopId,
        conflictId,
      })
        .session(session)
        .lean();
      if (priorConflict) {
        if (
          priorConflict.resolutionId === input.resolutionId &&
          priorConflict.requestHash === requestHash
        ) {
          response = {
            entry: priorConflict.selected,
            serverVersion: priorConflict.resultingVersion,
            resolutionVersion: priorConflict.resultingResolutionVersion || 1,
            resolutionId: priorConflict.resolutionId,
            serverAt: priorConflict.serverAt.toISOString(),
            audit: financialAuditOut(priorConflict),
          };
          return;
        }
        throw serviceError("This financial conflict has already been resolved", 409, {
          current,
          serverVersion: actualVersion,
          resolutionVersion: actualResolutionVersion,
        });
      }
      const previous = entryOut(doc);
      let selected = previous;
      if (input.choice === "keep_local") {
        const proposal = input.proposed;
        const customer = input.localDeleted
          ? true
          : await Customer.findOne({
              shopId,
              clientId: proposal.customerId,
              deletedAt: { $exists: false },
            })
              .session(session)
              .lean();
        if (!customer)
          throw serviceError("Customer is not available for this transaction", 409, {
            current,
            serverVersion: actualVersion,
            resolutionVersion: actualResolutionVersion,
          });
        const activeCustomer = customer.status === undefined && customer.disabled === undefined && customer.removed === undefined
          ? true
          : customer.status === true && customer.disabled === false && customer.removed === false;
        if (!activeCustomer)
          throw serviceError("This customer is disabled or removed", 409, {
            code: "CUSTOMER_NOT_ACTIVE", current,
            serverVersion: actualVersion,
            resolutionVersion: actualResolutionVersion,
          });
        const changed =
          !sameEntryValues(previous, proposal) ||
          !!doc.deletedAt !== input.localDeleted;
        if (changed) {
          doc.set({
            customerClientId: proposal.customerId,
            type: proposal.type,
            amountPaise: paise(proposal.amount),
            date: proposal.date,
            reference: proposal.reference || "",
            note: proposal.note,
            method: proposal.method,
            deletedAt: input.localDeleted ? new Date() : undefined,
            serverVersion: actualVersion + 1,
            resolutionVersion: actualResolutionVersion + 1,
          });
        }
        selected = input.localDeleted ? null : entryOut(doc);
      } else if (doc.deletedAt) selected = null;
      doc.resolutionVersion = actualResolutionVersion + 1;
      await doc.save({ session });
      const affectedCustomers = new Set([previous.customerId]);
      if (selected?.customerId) affectedCustomers.add(selected.customerId);
      for (const customerId of affectedCustomers)
        await reconcileCustomerAllocations(shopId, customerId, session);
      const updatedEntry = await Entry.findOne({ shopId, clientId: transactionId }).session(session);
      selected = input.localDeleted || updatedEntry.deletedAt ? null : entryOut(updatedEntry);
      const resultingVersion = updatedEntry.serverVersion || 1;
      const resultingResolutionVersion = updatedEntry.resolutionVersion || actualResolutionVersion;
      const serverAt = new Date();
      const customer = await Customer.findOne({
        shopId,
        clientId:
          selected?.customerId || input.proposed.customerId || previous.customerId,
      })
        .session(session)
        .select("name")
        .lean();
      const [resolutionRecord] = await FinancialResolution.create(
        [
          {
            shopId,
            transactionId,
            conflictId,
            customerName: customer?.name || "Customer",
            resolutionId: input.resolutionId,
            requestHash,
            actorId,
            previous,
            proposed: input.proposed,
            selected,
            previousVersion: actualVersion,
            resultingVersion,
            previousResolutionVersion: actualResolutionVersion,
            resultingResolutionVersion,
            localAt: input.localAt ? new Date(input.localAt) : undefined,
            action: input.choice,
            status: "resolved",
            serverAt,
          },
        ],
        { session },
      );
      response = {
        entry: selected,
        serverVersion: resultingVersion,
        resolutionVersion: resultingResolutionVersion,
        resolutionId: input.resolutionId,
        serverAt: serverAt.toISOString(),
        audit: financialAuditOut(resolutionRecord),
      };
      await Idempotency.create(
        [{ shopId, key, requestHash, response }],
        { session },
      );
    });
  } catch (err) {
    if (err.code === 11000) {
      const prior = await Idempotency.findOne({ shopId, key }).lean();
      if (prior?.requestHash === requestHash) return prior.response;
      const resolvedConflict = await FinancialResolution.findOne({
        shopId,
        conflictId,
      }).lean();
      if (resolvedConflict)
        throw serviceError("This financial conflict has already been resolved", 409, {
          current: resolvedConflict.selected,
          serverVersion: resolvedConflict.resultingVersion,
          resolutionVersion: resolvedConflict.resultingResolutionVersion || 1,
        });
      throw serviceError("Resolution identifier was already used", 409);
    }
    throw err;
  } finally {
    await session.endSession();
  }
  return response;
}
