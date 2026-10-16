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
  const customer = await Customer.findOne({
    shopId,
    clientId: entry.customerId,
    deletedAt: { $exists: false },
  }).lean();
  if (!customer) throw serviceError("Customer not found", 404);
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
  try {
    await session.withTransaction(async () => {
      let doc = await Entry.findOne({
        shopId,
        clientId: entry.id,
      }).session(session);
      if (doc) {
        if (doc.deletedAt || !sameEntryValues(entryOut(doc), entry))
          throw serviceError("Transaction identifier already exists", 409);
      } else {
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
              note: entry.note,
              method: entry.method,
              due: entry.due,
            },
          },
          { upsert: true, new: true, runValidators: true, session },
        );
      }
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
  return { status: 201, response };
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
  const customer = await Customer.findOne({
    shopId,
    clientId: value.customerId,
    deletedAt: { $exists: false },
  }).lean();
  if (!customer) throw serviceError("Customer not found", 404);
  const session = await mongoose.startSession();
  let response;
  try {
    await session.withTransaction(async () => {
      const doc = await Entry.findOne({
        shopId,
        clientId: value.id,
      }).session(session);
      if (!doc) throw serviceError("Transaction not found", 404);
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
          note: value.note,
          method: value.method,
          due: value.due,
        });
        doc.serverVersion = (doc.serverVersion || 1) + 1;
        doc.resolutionVersion = (doc.resolutionVersion || 1) + 1;
        await doc.save({ session });
      }
      if (audit)
        await saveAudit({ shopId, actorId, session }, audit);
      response = entryOut(doc);
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
      const doc = await Entry.findOne({ shopId, clientId: transactionId }).session(
        session,
      );
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
        const changed =
          !sameEntryValues(previous, proposal) ||
          !!doc.deletedAt !== input.localDeleted;
        if (changed) {
          doc.set({
            customerClientId: proposal.customerId,
            type: proposal.type,
            amountPaise: paise(proposal.amount),
            date: proposal.date,
            note: proposal.note,
            method: proposal.method,
            due: proposal.due,
            deletedAt: input.localDeleted ? new Date() : undefined,
            serverVersion: actualVersion + 1,
            resolutionVersion: actualResolutionVersion + 1,
          });
        }
        selected = input.localDeleted ? null : entryOut(doc);
      } else if (doc.deletedAt) selected = null;
      doc.resolutionVersion = actualResolutionVersion + 1;
      await doc.save({ session });
      if (selected) selected = entryOut(doc);
      const resultingVersion = doc.serverVersion || 1;
      const resultingResolutionVersion = doc.resolutionVersion || actualResolutionVersion;
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
