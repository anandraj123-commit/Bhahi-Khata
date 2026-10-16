import { shopConflictSchema, shopSchema } from "../validators/schemas.js";
import { shopOut } from "../utils/serializers.js";
import { error } from "../utils/http.js";
import { getShop, resolveShopConflict, updateShop } from "../services/shopService.js";
import { digest } from "../utils/hashing.js";
import { z } from "zod";

export const handle_get_shop = async (req, res, next) => {
  try {
    const s = await getShop(req.shopId);
    res.json(shopOut(s));
  } catch (e) {
    next(e);
  }
};

export const handle_patch_shop = async (req, res, next) => {
  try {
    const { baseSettings, baseVersion, baseResolutionVersion, ...input } = req.body || {};
    if (baseVersion !== undefined && !z.number().int().min(1).safeParse(baseVersion).success)
      return error(res, 400, "Invalid shop settings version");
    if (baseResolutionVersion !== undefined && !z.number().int().min(1).safeParse(baseResolutionVersion).success)
      return error(res, 400, "Invalid shop settings resolution version");
    const hasBaseSettings = Object.hasOwn(req.body || {}, "baseSettings");
    const parsed = shopSchema.safeParse(input);
    if (!parsed.success) return error(res, 400, "Invalid shop profile");
    const base = hasBaseSettings ? shopSchema.safeParse(baseSettings) : null;
    if (hasBaseSettings && !base?.success)
      return error(res, 400, "Invalid shop settings version");
    if (parsed.data.phone !== req.user.phone)
      return error(
        res,
        403,
        "Shop phone cannot be changed without phone verification",
      );
    const s = await updateShop({
      shopId: req.shopId,
      input: parsed.data,
      base,
      baseVersion,
      baseResolutionVersion,
    });
    res.json(shopOut(s));
  } catch (e) {
    if (e.status === 409 && e.current !== undefined)
      return res.status(409).json({ error: e.message, type: "shop_settings_conflict", current: e.current, serverVersion: e.serverVersion || e.current?.serverVersion || 1, resolutionVersion: e.resolutionVersion || e.current?.resolutionVersion || 1 });
    if (e.status === 404 || e.status === 409) return error(res, e.status, e.message);
    next(e);
  }
};

export const handle_post_shop_resolve = async (req, res, next) => {
  const parsed = shopConflictSchema.safeParse(req.body || {});
  if (!parsed.success) return error(res, 400, "Invalid shop settings conflict resolution");
  try {
    const input = parsed.data;
    const requestHash = digest(JSON.stringify(input));
    res.json(await resolveShopConflict({
      shopId: req.shopId,
      actorId: req.user._id,
      input,
      key: `shop-resolution:${input.resolutionId}`,
      requestHash,
    }));
  } catch (e) {
    if (e.status === 409)
      return res.status(409).json({ error: e.message, ...(e.current !== undefined ? { type: "shop_settings_conflict", current: e.current, serverVersion: e.serverVersion || e.current?.serverVersion || 1, resolutionVersion: e.resolutionVersion || e.current?.resolutionVersion || 1 } : {}), ...(e.code ? { code: e.code } : {}), ...(e.audit ? { audit: e.audit } : {}) });
    if (e.status === 403 || e.status === 404) return error(res, e.status, e.message);
    next(e);
  }
};
