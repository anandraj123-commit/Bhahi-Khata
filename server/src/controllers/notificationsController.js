import { z } from "zod";
import { error } from "../utils/http.js";
import {
  listNotifications,
  markNotificationsRead,
} from "../services/notificationsService.js";
const idsSchema = z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(100);
export const handle_get_notifications = async (req, res, next) => {
  try {
    const f = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(100),
      })
      .strict()
      .safeParse(req.query);
    if (!f.success) return error(res, 400, "Invalid pagination");
    res.json(await listNotifications(req.shopId, req.user._id, f.data));
  } catch (e) {
    next(e);
  }
};
export const handle_patch_notifications_read = async (req, res, next) => {
  try {
    const ids = idsSchema.safeParse(req.body?.ids);
    if (!ids.success) return error(res, 400, "Invalid notification IDs");
    await markNotificationsRead({
      shopId: req.shopId,
      userId: req.user._id,
      ids: ids.data,
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
};
export const handle_reconcile_notifications = async (req, res, next) => {
  try {
    const ids = idsSchema.safeParse(req.body?.ids);
    if (!ids.success) return error(res, 400, "Invalid notification IDs");
    const result = await listNotifications(req.shopId, req.user._id, {
      ids: ids.data,
      limit: 100,
    });
    const visible = new Set(result.items.map((n) => n.id));
    res.json({
      ...result,
      hiddenIds: ids.data.filter((id) => !visible.has(id)),
    });
  } catch (e) {
    next(e);
  }
};
export const handle_get_notification = async (req, res, next) => {
  try {
    const ids = idsSchema.safeParse([req.params.id]);
    if (!ids.success) return error(res, 400, "Invalid notification ID");
    const r = await listNotifications(req.shopId, req.user._id, {
      ids: ids.data,
      limit: 1,
    });
    if (!r.items.length) return error(res, 404, "Notification unavailable");
    res.json(r.items[0]);
  } catch (e) {
    next(e);
  }
};
