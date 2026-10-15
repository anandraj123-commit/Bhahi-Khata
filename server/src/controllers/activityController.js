import { z } from "zod";
import { idSchema } from "../validators/schemas.js";
import { error } from "../utils/http.js";
import { listActivity, markActivityRead } from "../services/activityService.js";

export const handle_get_activity = async (req, res, next) => {
  try {
    const limit = Math.min(
      500,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 100),
    );
    res.json(
      await listActivity({
        shopId: req.shopId,
        limit,
        token: String(req.query.cursor || ""),
      }),
    );
  } catch (e) {
    next(e);
  }
};

export const handle_patch_activity_read = async (req, res, next) => {
  try {
    const ids = z.array(idSchema).max(100).safeParse(req.body?.ids);
    if (!ids.success) return error(res, 400, "Invalid activity IDs");
    await markActivityRead({ shopId: req.shopId, ids: ids.data });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
};
