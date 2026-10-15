import { shopSchema } from "../validators/schemas.js";
import { shopOut } from "../utils/serializers.js";
import { error } from "../utils/http.js";
import { getShop, updateShop } from "../services/shopService.js";

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
    const { baseSettings, ...input } = req.body || {};
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
    });
    res.json(shopOut(s));
  } catch (e) {
    if (e.status === 404 || e.status === 409) return error(res, e.status, e.message);
    next(e);
  }
};
