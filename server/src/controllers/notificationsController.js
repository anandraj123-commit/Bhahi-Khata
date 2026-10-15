import { z } from "zod";
import { error } from "../utils/http.js";
import {
  listNotifications,
  markNotificationsRead,
} from "../services/notificationsService.js";

export const handle_get_notifications = async (req, res, next) => {
  try {
    res.json(await listNotifications(req.shopId));
  } catch (e) {
    next(e);
  }
};

export const handle_patch_notifications_read = async (req, res, next) => {
  try {
    const ids = z.array(z.string().max(40)).max(100).safeParse(req.body?.ids);
    if (!ids.success) return error(res, 400, "Invalid notification IDs");
    await markNotificationsRead({ shopId: req.shopId, ids: ids.data });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
};
