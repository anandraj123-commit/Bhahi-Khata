import mongoose from "mongoose";
import { Audit, Customer, Idempotency } from "../models.js";
import { digest } from "../utils/hashing.js";
import { paise } from "../utils/money.js";
import { customerOut } from "../utils/serializers.js";
import { sameCustomerValues } from "../utils/records.js";
import { normalizeCustomerMobile } from "../utils/phone.js";
import { qualifyReferralInTransaction } from "./referralService.js";
import { saveAudit } from "./auditService.js";
import { canTransitionCustomerStatus, customerStatusName, lifecycleTarget } from "../utils/customerLifecycle.js";
import {
  ensureCustomerUsage,
  releaseCustomerCapacity,
  reserveCustomerCapacity,
} from "./subscriptionService.js";

function duplicateCustomerMobile() {
  return Object.assign(new Error("A customer with this mobile number already exists in this shop"), {
    status: 409,
    code: "CUSTOMER_MOBILE_ALREADY_EXISTS",
  });
}

async function assertCustomerMobileAvailable({ shopId, phone, excludeClientId, session }) {
  if (!phone) return;
  const normalized = normalizeCustomerMobile(phone);
  if (!normalized) throw Object.assign(new Error("Enter a valid 10-digit Indian mobile number"), { status: 400 });
  const candidates = await Customer.find({ shopId, deletedAt: { $exists: false }, phone: { $ne: "" } })
    .select("clientId phone phoneNormalized")
    .session(session)
    .lean();
  if (candidates.some((candidate) =>
    candidate.clientId !== excludeClientId &&
    normalizeCustomerMobile(candidate.phoneNormalized || candidate.phone) === normalized
  )) throw duplicateCustomerMobile();
}

export async function listCustomers({ shopId, query, cursorId, limit }) {
  const filter = { shopId, deletedAt: { $exists: false } };
  if (query)
    filter.nameFolded = {
      $regex: `^${query.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    };
  if (cursorId) {
    const cursor = await Customer.findOne({ shopId, clientId: cursorId })
      .select("_id nameFolded")
      .lean();
    if (cursor)
      filter.$or = [
        { nameFolded: { $gt: cursor.nameFolded } },
        { nameFolded: cursor.nameFolded, _id: { $gt: cursor._id } },
      ];
  }
  const rows = await Customer.find(filter)
    .sort({ nameFolded: 1, _id: 1 })
    .limit(limit + 1)
    .lean();
  const more = rows.length > limit;
  if (more) rows.pop();
  return {
    items: rows.map(customerOut),
    nextCursor: more ? rows.at(-1).clientId : null,
  };
}

export async function createCustomer({ shopId, actorId, customer, audit }) {
  await ensureCustomerUsage(shopId);
  const openingPaise = paise(customer.opening);
  const openingAdvancePaise = paise(customer.openingAdvance || 0);
  const session = await mongoose.startSession();
  let doc;
  try {
    await session.withTransaction(async () => {
      doc = await Customer.findOne({
        shopId,
        clientId: customer.id,
      }).session(session);
      if (doc) {
        if (doc.deletedAt || !sameCustomerValues(customerOut(doc), customer))
          throw Object.assign(new Error("Customer identifier already exists"), {
            status: 409,
            current: doc.deletedAt ? null : customerOut(doc),
            serverVersion: doc.serverVersion || 1,
          });
      } else {
        await assertCustomerMobileAvailable({ shopId, phone: customer.phone, excludeClientId: customer.id, session });
        await reserveCustomerCapacity({ shopId, session });
        const now = new Date();
        doc = await Customer.findOneAndUpdate(
            { shopId, clientId: customer.id },
          {
            $set: {
              shopId,
              clientId: customer.id,
              name: customer.name,
              nameFolded: customer.name.toLocaleLowerCase("en"),
              phone: customer.phone,
              ...(customer.whatsappNumber !== undefined ? { whatsappNumber: customer.whatsappNumber } : {}),
              ...(customer.phone ? { phoneNormalized: customer.phone } : {}),
              phoneActive: Boolean(customer.phone),
              address: customer.address,
              openingPaise,
              openingAdvancePaise,
              openingDate: customer.openingDate
                ? new Date(`${customer.openingDate}T00:00:00.000Z`)
                : new Date(),
              limitPaise: paise(customer.limit),
              reminder: customer.reminder,
              status: true,
              disabled: false,
              removed: false,
            },
            $setOnInsert: {
              createdAt: customer.createdAt ? new Date(customer.createdAt) : now,
              updatedAt: now,
            },
            ...(customer.phone ? {} : { $unset: { phoneNormalized: 1 } }),
          },
          { upsert: true, new: true, runValidators: true, session, timestamps: false },
        );
      }
      if (audit)
        await saveAudit({ shopId, actorId, session }, audit);
      await qualifyReferralInTransaction(shopId, session);
    });
  } catch (error) {
    // A retry after an ambiguous response, or a concurrent request using the
    // same client UUID, must resolve to the original customer rather than
    // failing as a duplicate-key server error.
    if (error.code === 11000 && (error.keyPattern?.phoneNormalized || String(error.message).includes("active_customer_mobile_unique")))
      throw duplicateCustomerMobile();
    if (error.code === 11000) {
      const existing = await Customer.findOne({ shopId, clientId: customer.id }).lean();
      if (existing && !existing.deletedAt && sameCustomerValues(customerOut(existing), customer))
        return existing;
      if (existing)
        throw Object.assign(new Error("Customer identifier already exists"), {
          status: 409,
          current: existing.deletedAt ? null : customerOut(existing),
          serverVersion: existing.serverVersion || 1,
        });
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return doc;
}

export async function updateCustomer({ shopId, actorId, customer, base, baseVersion, baseResolutionVersion, audit }) {
  const session = await mongoose.startSession();
  let doc;
  try {
    await session.withTransaction(async () => {
      doc = await Customer.findOne({
        shopId,
        clientId: customer.id,
      }).session(session);
      if (!doc)
        throw Object.assign(new Error("Customer not found"), { status: 404 });
      if (doc.deletedAt)
        throw Object.assign(new Error("Customer was deleted on another device"), {
          status: 409,
          current: null,
          serverVersion: doc.serverVersion || 1,
          resolutionVersion: doc.resolutionVersion || 1,
        });
      const current = customerOut(doc);
      if (customerStatusName(current) !== "active")
        throw Object.assign(new Error("Disabled or removed customers cannot be edited"), {
          status: 409, code: "CUSTOMER_NOT_ACTIVE", current,
          serverVersion: doc.serverVersion || 1,
          resolutionVersion: doc.resolutionVersion || 1,
        });
      const actualVersion = doc.serverVersion || 1;
      if (
        ((base?.success && !sameCustomerValues(current, base.data)) ||
          (baseVersion && actualVersion !== baseVersion) ||
          (baseResolutionVersion && (doc.resolutionVersion || 1) !== baseResolutionVersion)) &&
        !sameCustomerValues(current, customer)
      )
        throw Object.assign(new Error("Customer changed on another device"), {
          status: 409,
          current,
          serverVersion: actualVersion,
          resolutionVersion: doc.resolutionVersion || 1,
        });
      if (!sameCustomerValues(current, customer)) {
        await assertCustomerMobileAvailable({ shopId, phone: customer.phone, excludeClientId: customer.id, session });
        doc.set({
          name: customer.name,
          nameFolded: customer.name.toLocaleLowerCase("en"),
          phone: customer.phone,
          ...(customer.whatsappNumber !== undefined ? { whatsappNumber: customer.whatsappNumber } : {}),
          phoneNormalized: customer.phone || undefined,
          phoneActive: Boolean(customer.phone),
          address: customer.address,
          limitPaise: paise(customer.limit),
          reminder: customer.reminder,
          serverVersion: actualVersion + 1,
          resolutionVersion: (doc.resolutionVersion || 1) + 1,
        });
        if (!customer.phone) doc.phoneNormalized = undefined;
        await doc.save({ session });
      }
      if (audit)
        await saveAudit({ shopId, actorId, session }, audit);
    });
  } finally {
    await session.endSession();
  }
  return doc;
}

/** Apply one explicit, version-checked lifecycle transition. The customer and
 * all ledger records remain present; mobile-number reservation is unchanged. */
export async function transitionCustomer({ shopId, actorId, customerId, target, operationId, baseVersion, baseResolutionVersion, reason }) {
  await ensureCustomerUsage(shopId);
  const targetFlags = lifecycleTarget(target);
  if (!targetFlags)
    throw Object.assign(new Error("Invalid customer lifecycle target"), { status: 400, code: "CUSTOMER_STATUS_INVALID" });
  const key = `customer-lifecycle:${operationId}`;
  const requestHash = digest(JSON.stringify({ customerId, target, baseVersion, baseResolutionVersion, reason: reason || "" }));
  const prior = await Idempotency.findOne({ shopId, key }).lean();
  if (prior) {
    if (prior.requestHash !== requestHash)
      throw Object.assign(new Error("Lifecycle operation identifier was already used"), { status: 409, code: "CUSTOMER_STATUS_CONFLICT" });
    return prior.response;
  }
  const session = await mongoose.startSession();
  let response;
  try {
    await session.withTransaction(async () => {
      const repeated = await Idempotency.findOne({ shopId, key }).session(session).lean();
      if (repeated) {
        if (repeated.requestHash !== requestHash)
          throw Object.assign(new Error("Lifecycle operation identifier was already used"), { status: 409, code: "CUSTOMER_STATUS_CONFLICT" });
        response = repeated.response;
        return;
      }
      const doc = await Customer.findOne({ shopId, clientId: customerId, deletedAt: { $exists: false } }).session(session);
      if (!doc) throw Object.assign(new Error("Customer not found"), { status: 404, code: "CUSTOMER_NOT_FOUND" });
      const current = customerOut(doc);
      const from = customerStatusName(current);
      if (from === "invalid" || !canTransitionCustomerStatus(from, target))
        throw Object.assign(new Error("This customer status change is not allowed"), {
          status: 409, code: "CUSTOMER_STATUS_TRANSITION_INVALID", current,
          serverVersion: doc.serverVersion || 1, resolutionVersion: doc.resolutionVersion || 1,
        });
      const actualVersion = doc.serverVersion || 1;
      const actualResolutionVersion = doc.resolutionVersion || 1;
      if (actualVersion !== baseVersion || actualResolutionVersion !== baseResolutionVersion) {
        // An identical already-applied transition is harmless and idempotent,
        // even if the response to the first request was lost.
        if (from !== target)
          throw Object.assign(new Error("Customer status changed on another device"), {
            status: 409, code: "CUSTOMER_STATUS_CONFLICT", current,
            serverVersion: actualVersion, resolutionVersion: actualResolutionVersion,
          });
      }
      if (from !== target) {
        if (from === "active" && target !== "active") await releaseCustomerCapacity({ shopId, session });
        if (from !== "active" && target === "active") await reserveCustomerCapacity({ shopId, session });
        doc.set({ ...targetFlags, serverVersion: actualVersion + 1, resolutionVersion: actualResolutionVersion + 1 });
        await doc.save({ session });
      }
      if (from !== target) {
        const action = target === "disabled" ? "CUSTOMER_DISABLED" : target === "removed" ? "CUSTOMER_REMOVED" : from === "removed" ? "CUSTOMER_RESTORED" : "CUSTOMER_ENABLED";
        await Audit.updateOne(
          { shopId, clientId: operationId },
          { $setOnInsert: {
            shopId, actorId, clientId: operationId, action,
            before: { customerId, status: from },
            after: { customerId, status: target, ...(reason ? { reason } : {}) },
            resolutionId: operationId, requestHash, occurredAt: new Date(),
          } },
          { upsert: true, session },
        );
      }
      response = customerOut(doc);
      await Idempotency.create([{ shopId, key, requestHash, response }], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const found = await Idempotency.findOne({ shopId, key }).lean();
      if (found?.requestHash === requestHash) return found.response;
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return response;
}

export async function deleteCustomer({ shopId, actorId, id, base, baseVersion, baseResolutionVersion, audit }) {
  await ensureCustomerUsage(shopId);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const customer = await Customer.findOne({ shopId, clientId: id }).session(
        session,
      );
      if (!customer)
        throw Object.assign(new Error("Customer not found"), { status: 404 });
      if (customer.deletedAt) return;
      const actualVersion = customer.serverVersion || 1;
      if (
        ((base?.success && !sameCustomerValues(customerOut(customer), base.data)) ||
          (baseVersion && actualVersion !== baseVersion) ||
          (baseResolutionVersion && (customer.resolutionVersion || 1) !== baseResolutionVersion))
      )
        throw Object.assign(new Error("Customer changed on another device"), {
          status: 409,
          current: customerOut(customer),
          serverVersion: actualVersion,
          resolutionVersion: customer.resolutionVersion || 1,
        });
      customer.deletedAt = new Date();
      customer.phoneActive = false;
      customer.serverVersion = actualVersion + 1;
      customer.resolutionVersion = (customer.resolutionVersion || 1) + 1;
      await customer.save({ session });
      await releaseCustomerCapacity({ shopId, session });
      if (audit) await saveAudit({ shopId, actorId, session }, audit);
    });
  } finally {
    await session.endSession();
  }
}

export async function resolveCustomerConflict({
  shopId,
  actorId,
  customerId,
  input,
  key,
  requestHash,
  conflictId,
}) {
  await ensureCustomerUsage(shopId);
  const previousRequest = await Idempotency.findOne({ shopId, key }).lean();
  if (previousRequest) {
    if (previousRequest.requestHash !== requestHash)
      throw Object.assign(new Error("Resolution identifier was already used for another choice"), { status: 409 });
    return previousRequest.response;
  }
  const session = await mongoose.startSession();
  let response;
  try {
    await session.withTransaction(async () => {
      const repeated = await Idempotency.findOne({ shopId, key }).session(session).lean();
      if (repeated) {
        if (repeated.requestHash !== requestHash)
          throw Object.assign(new Error("Resolution identifier was already used for another choice"), { status: 409 });
        response = repeated.response;
        return;
      }
      const customer = await Customer.findOne({ shopId, clientId: customerId }).session(session);
      const actualVersion = customer?.serverVersion || 1;
      const actualResolutionVersion = customer?.resolutionVersion || 1;
      const current = customer && !customer.deletedAt ? customerOut(customer) : null;
      const conflictAuditId = `customer-conflict-${conflictId}`;
      const claimed = await Audit.findOne({ shopId, clientId: conflictAuditId }).session(session).lean();
      if (claimed?.resolutionId === input.resolutionId && claimed.requestHash === requestHash && claimed.resolutionResponse) {
        response = claimed.resolutionResponse;
        return;
      }
      if (claimed)
        throw Object.assign(new Error("This customer conflict has already been resolved"), {
          status: 409,
          code: "CUSTOMER_CONFLICT_RESOLVED",
          current,
          serverVersion: actualVersion,
          resolutionVersion: actualResolutionVersion,
          audit: { id: claimed.clientId, action: claimed.action, date: claimed.occurredAt.toISOString() },
        });
      if (!customer || actualVersion !== input.expectedVersion || actualResolutionVersion !== input.expectedResolutionVersion)
        throw Object.assign(new Error("Customer changed while the conflict was open"), {
          status: 409,
          current,
          serverVersion: actualVersion,
          resolutionVersion: actualResolutionVersion,
        });

      const previous = current;
      let selected = current;
      if (input.choice === "keep_local") {
        const wasDeleted = !!customer.deletedAt;
        if (input.localDeleted) {
          if (!wasDeleted) {
            customer.deletedAt = new Date();
            customer.phoneActive = false;
            customer.serverVersion = actualVersion + 1;
            await releaseCustomerCapacity({ shopId, session });
          }
          selected = null;
        } else {
          const proposed = input.proposed;
          const currentStatus = customerStatusName(customerOut(customer));
          const proposedStatus = input.lifecycleChange ? customerStatusName(proposed) : currentStatus;
          if (proposedStatus === "invalid" || !canTransitionCustomerStatus(currentStatus, proposedStatus))
            throw Object.assign(new Error("Customer status changed and needs a valid resolution"), {
              status: 409, code: "CUSTOMER_STATUS_CONFLICT", current,
              serverVersion: actualVersion, resolutionVersion: actualResolutionVersion,
            });
          if (currentStatus !== "active" && currentStatus === proposedStatus && !sameCustomerValues(customerOut(customer), proposed))
            throw Object.assign(new Error("Disabled or removed customers cannot be edited"), {
              status: 409, code: "CUSTOMER_NOT_ACTIVE", current,
              serverVersion: actualVersion, resolutionVersion: actualResolutionVersion,
            });
          await assertCustomerMobileAvailable({ shopId, phone: proposed.phone, excludeClientId: customerId, session });
          const openingPaise = paise(proposed.opening);
          const openingAdvancePaise = paise(proposed.openingAdvance || 0);
          const changed = wasDeleted || currentStatus !== proposedStatus || !sameCustomerValues(customerOut(customer), proposed);
          if (changed) {
            if (wasDeleted) await reserveCustomerCapacity({ shopId, session });
            else if (input.lifecycleChange && currentStatus === "active" && proposedStatus !== "active") await releaseCustomerCapacity({ shopId, session });
            else if (input.lifecycleChange && currentStatus !== "active" && proposedStatus === "active") await reserveCustomerCapacity({ shopId, session });
            customer.set({
              name: proposed.name,
              nameFolded: proposed.name.toLocaleLowerCase("en"),
              phone: proposed.phone,
              ...(proposed.whatsappNumber !== undefined ? { whatsappNumber: proposed.whatsappNumber } : {}),
              phoneNormalized: proposed.phone || undefined,
              phoneActive: Boolean(proposed.phone),
              address: proposed.address,
              openingPaise,
              openingAdvancePaise,
              openingDate: proposed.openingDate
                ? new Date(`${proposed.openingDate}T00:00:00.000Z`)
                : customer.openingDate || customer.createdAt,
              limitPaise: paise(proposed.limit),
              reminder: proposed.reminder,
              ...lifecycleTarget(proposedStatus),
              deletedAt: undefined,
              serverVersion: actualVersion + 1,
              resolutionVersion: actualResolutionVersion + 1,
            });
            if (!proposed.phone) customer.phoneNormalized = undefined;
            if (input.lifecycleChange && currentStatus !== proposedStatus) {
              const lifecycleAction = proposedStatus === "disabled"
                ? "CUSTOMER_DISABLED"
                : proposedStatus === "removed"
                  ? "CUSTOMER_REMOVED"
                  : currentStatus === "removed" ? "CUSTOMER_RESTORED" : "CUSTOMER_ENABLED";
              await Audit.updateOne(
                { shopId, clientId: `customer-lifecycle-resolution-${input.resolutionId}` },
                { $setOnInsert: {
                  shopId, actorId,
                  clientId: `customer-lifecycle-resolution-${input.resolutionId}`,
                  action: lifecycleAction,
                  before: { customerId, status: currentStatus },
                  after: { customerId, status: proposedStatus },
                  resolutionId: input.resolutionId,
                  requestHash,
                  occurredAt: new Date(),
                } },
                { upsert: true, session },
              );
            }
          }
          selected = customerOut(customer);
        }
      }
      if (input.choice === "keep_server" || customer.resolutionVersion !== actualResolutionVersion + 1) {
        customer.resolutionVersion = actualResolutionVersion + 1;
      }
      await customer.save({ session });
      if (selected) selected = customerOut(customer);
      const serverAt = new Date();
      const action = `Customer conflict resolved: ${input.choice === "keep_local" ? "phone version" : "server version"}`;
      const auditData = { id: conflictAuditId, action, date: serverAt.toISOString() };
      response = {
        customer: selected,
        serverVersion: customer.serverVersion || actualVersion,
        resolutionVersion: customer.resolutionVersion || actualResolutionVersion,
        resolutionId: input.resolutionId,
        serverAt: serverAt.toISOString(),
        audit: auditData,
      };
      await Audit.create([{
        shopId,
        actorId,
        clientId: conflictAuditId,
        action,
        resolutionId: input.resolutionId,
        requestHash,
        resolutionResponse: response,
        occurredAt: serverAt,
      }], { session });
      await Idempotency.create([{ shopId, key, requestHash, response }], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const repeated = await Idempotency.findOne({ shopId, key }).lean();
      if (repeated?.requestHash === requestHash) return repeated.response;
      const current = await Customer.findOne({ shopId, clientId: customerId, deletedAt: { $exists: false } }).lean();
      const claimed = await Audit.findOne({ shopId, clientId: `customer-conflict-${conflictId}` }).lean();
      if (claimed?.resolutionId === input.resolutionId && claimed.requestHash === requestHash && claimed.resolutionResponse)
        return claimed.resolutionResponse;
      throw Object.assign(new Error("This customer conflict has already been resolved"), {
        status: 409,
        ...(claimed ? { code: "CUSTOMER_CONFLICT_RESOLVED", audit: { id: claimed.clientId, action: claimed.action, date: claimed.occurredAt.toISOString() } } : {}),
        current: current ? customerOut(current) : null,
        serverVersion: current?.serverVersion || 1,
      });
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return response;
}
