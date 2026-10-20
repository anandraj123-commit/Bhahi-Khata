import mongoose from "mongoose";
import {
  Audit, Customer, Device, Entry, FinancialResolution, Idempotency, Notification,
  PaymentOrder, PaymentTransaction, ReminderDelivery, Shop, ShopSubscription,
  SubscriptionAuditLog, SubscriptionNotificationLog,
  SubscriptionNotificationPreference, SubscriptionUsage, User,
} from "../models.js";
import { digest } from "../utils/hashing.js";
import { shopOut } from "../utils/serializers.js";
import { isShopSettingsConflict, sameShopValues } from "../utils/records.js";
import { normalizePhone } from "../utils/phone.js";

const shopScopedModels = [
  Customer, Entry, Audit, FinancialResolution, Notification, Device, Idempotency,
  ReminderDelivery, ShopSubscription, PaymentOrder, PaymentTransaction,
  SubscriptionAuditLog, SubscriptionNotificationLog,
  SubscriptionNotificationPreference, SubscriptionUsage,
];

export async function hasShopScopedData(shopId, session) {
  if (!shopId) return false;
  const counts = await Promise.all(shopScopedModels.map((Model) => {
    let query = Model.countDocuments({ shopId }).limit(1);
    if (session) query = query.session(session);
    return query;
  }));
  return counts.some((count) => count > 0);
}

export async function getShop(shopId) {
  return Shop.findById(shopId).lean();
}

export async function registerShop({ userId, input }) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const user = await User.findOne({ _id: userId, disabledAt: { $exists: false } }).session(session);
      if (!user) throw Object.assign(new Error("Account unavailable"), { status: 401 });
      const linkedShop = user.shopId ? await Shop.findById(user.shopId).session(session) : null;
      if (linkedShop && String(linkedShop.ownerId) !== String(user._id))
        throw Object.assign(new Error("Account and shop registration need support review"), { status: 409, code: "ACCOUNT_SHOP_LINK_CONFLICT" });
      if (user.shopId && !linkedShop && await hasShopScopedData(user.shopId, session))
        throw Object.assign(new Error("Existing shop data needs support recovery before registration"), { status: 409, code: "ACCOUNT_SHOP_LINK_CONFLICT" });
      const owned = await Shop.findOne({ ownerId: user._id }).session(session);
      if (owned) {
        if (String(user.shopId || "") !== String(owned._id) || normalizePhone(owned.phone) !== normalizePhone(user.phone))
          throw Object.assign(new Error("Account and shop registration need support review"), { status: 409, code: "ACCOUNT_SHOP_LINK_CONFLICT" });
        result = { shop: owned, created: false };
        return;
      }
      const phoneMatch = await Shop.findOne({ phone: normalizePhone(user.phone) }).session(session);
      if (phoneMatch)
        throw Object.assign(new Error("A shop is already registered with this mobile number"), { status: 409, code: "SHOP_PHONE_ALREADY_REGISTERED" });
      if (!normalizePhone(user.phone))
        throw Object.assign(new Error("Account mobile number is invalid; contact support"), { status: 409, code: "ACCOUNT_PHONE_INVALID" });
      const [shop] = await Shop.create([{
        ownerId: user._id,
        name: input.name,
        owner: input.owner,
        address: input.address || "",
        phone: normalizePhone(user.phone),
        whatsapp: input.whatsapp || "",
        ...(input.language ? { language: input.language } : {}),
      }], { session });
      user.shopId = shop._id;
      await user.save({ session });
      result = { shop, created: true };
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const [user, owned] = await Promise.all([
      User.findById(userId).lean(),
      Shop.findOne({ ownerId: userId }).lean(),
    ]);
    if (user && owned && String(user.shopId || "") === String(owned._id) && normalizePhone(owned.phone) === normalizePhone(user.phone))
      return { shop: owned, created: false };
    throw Object.assign(new Error("A shop is already registered with this mobile number"), { status: 409, code: "SHOP_PHONE_ALREADY_REGISTERED" });
  } finally {
    await session.endSession();
  }
  return result;
}

export async function updateShop({ shopId, input, base, baseVersion, baseResolutionVersion }) {
  const session = await mongoose.startSession();
  let shop;
  try {
    await session.withTransaction(async () => {
      shop = await Shop.findById(shopId).session(session);
      if (!shop) throw Object.assign(new Error("Shop not found"), { status: 404 });
      const current = shopOut(shop);
      const actualVersion = shop.serverVersion || 1;
      if (isShopSettingsConflict({
        current,
        input,
        base,
        actualVersion,
        baseVersion,
        actualResolutionVersion: shop.resolutionVersion || 1,
        baseResolutionVersion,
      }))
        throw Object.assign(new Error("Shop settings changed on another device"), {
          status: 409,
          code: "SHOP_SETTINGS_CONFLICT",
          current,
          serverVersion: actualVersion,
          resolutionVersion: shop.resolutionVersion || 1,
        });
      if (!sameShopValues(current, input)) {
        shop.set(input);
        shop.serverVersion = actualVersion + 1;
        shop.resolutionVersion = (shop.resolutionVersion || 1) + 1;
        await shop.save({ session });
      }
    });
  } finally {
    await session.endSession();
  }
  return shop;
}

function settingsSnapshot(shop) {
  const value = shopOut(shop);
  return {
    shop: {
      name: value.name,
      owner: value.owner,
      address: value.address,
      phone: value.phone,
      whatsapp: value.whatsapp,
      serverVersion: value.serverVersion,
      resolutionVersion: value.resolutionVersion,
    },
    language: value.language,
    defaultMethod: value.defaultMethod,
    reminders: value.reminders,
  };
}

export async function resolveShopConflict({
  shopId,
  actorId,
  input,
  key,
  requestHash: suppliedRequestHash,
}) {
  const requestHash = suppliedRequestHash || digest(JSON.stringify(input));
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
      const shop = await Shop.findById(shopId).session(session);
      if (!shop) throw Object.assign(new Error("Shop not found"), { status: 404 });
      const actualVersion = shop.serverVersion || 1;
      const actualResolutionVersion = shop.resolutionVersion || 1;
      const claimId = `shop-conflict-v${input.expectedVersion}-r${input.expectedResolutionVersion}`;
      const claim = await Audit.findOne({ shopId, clientId: claimId }).session(session).lean();
      if (claim?.resolutionId === input.resolutionId && claim.requestHash === requestHash && claim.resolutionResponse) {
        response = claim.resolutionResponse;
        return;
      }
      if (claim)
        throw Object.assign(new Error("These shop settings were already resolved"), {
          status: 409,
          code: "SHOP_CONFLICT_RESOLVED",
          current: shopOut(shop),
          serverVersion: actualVersion,
          resolutionVersion: actualResolutionVersion,
          audit: { id: claim.clientId, action: claim.action, date: claim.occurredAt.toISOString() },
        });
      if (actualVersion !== input.expectedVersion || actualResolutionVersion !== input.expectedResolutionVersion)
        throw Object.assign(new Error("Shop settings changed while the conflict was open"), {
          status: 409,
          current: shopOut(shop),
          serverVersion: actualVersion,
          resolutionVersion: actualResolutionVersion,
        });

      const previous = shopOut(shop);
      if (input.choice === "keep_local") {
        if (input.proposed.phone !== shop.phone)
          throw Object.assign(new Error("Shop phone changes require online phone verification"), { status: 403 });
        if (!sameShopValues(previous, input.proposed)) {
          shop.set(input.proposed);
          shop.serverVersion = actualVersion + 1;
        }
      }
      shop.resolutionVersion = actualResolutionVersion + 1;
      await shop.save({ session });
      const serverAt = new Date();
      const action = `Shop settings conflict resolved: ${input.choice === "keep_local" ? "phone version" : "server version"}`;
      response = {
        settings: settingsSnapshot(shop),
        serverVersion: shop.serverVersion || actualVersion,
        resolutionVersion: shop.resolutionVersion || actualResolutionVersion,
        resolutionId: input.resolutionId,
        serverAt: serverAt.toISOString(),
        audit: { id: claimId, action, date: serverAt.toISOString() },
      };
      await Audit.create([{
        shopId,
        actorId,
        clientId: claimId,
        action,
        resolutionId: input.resolutionId,
        requestHash,
        resolutionResponse: response,
        before: { serverVersion: actualVersion },
        after: { serverVersion: response.serverVersion },
        occurredAt: serverAt,
      }], { session });
      await Idempotency.create([{ shopId, key, requestHash, response }], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const repeated = await Idempotency.findOne({ shopId, key }).lean();
      if (repeated?.requestHash === requestHash) return repeated.response;
      const claim = await Audit.findOne({ shopId, clientId: `shop-conflict-v${input.expectedVersion}-r${input.expectedResolutionVersion}` }).lean();
      if (claim?.resolutionId === input.resolutionId && claim.requestHash === requestHash && claim.resolutionResponse)
        return claim.resolutionResponse;
      const shop = await Shop.findById(shopId).lean();
      throw Object.assign(new Error("These shop settings were already resolved"), {
        status: 409,
        ...(claim ? { code: "SHOP_CONFLICT_RESOLVED", audit: { id: claim.clientId, action: claim.action, date: claim.occurredAt.toISOString() } } : {}),
        ...(shop ? { current: shopOut(shop), serverVersion: shop.serverVersion || 1, resolutionVersion: shop.resolutionVersion || 1 } : {}),
      });
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return response;
}
