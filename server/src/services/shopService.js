import mongoose from "mongoose";
import { Audit, Idempotency, Shop } from "../models.js";
import { digest } from "../utils/hashing.js";
import { shopOut } from "../utils/serializers.js";
import { sameShopValues } from "../utils/records.js";

export async function getShop(shopId) {
  return Shop.findById(shopId).lean();
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
      if (
        ((base?.success && !sameShopValues(current, base.data)) ||
          (baseVersion && actualVersion !== baseVersion) ||
          (baseResolutionVersion && (shop.resolutionVersion || 1) !== baseResolutionVersion)) &&
        !sameShopValues(current, input)
      )
        throw Object.assign(new Error("Shop settings changed on another device"), {
          status: 409,
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
