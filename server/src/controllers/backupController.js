import { backupSchema } from "../validators/schemas.js";
import { error } from "../utils/http.js";
import { restoreBackup } from "../services/backupService.js";

export const handle_post_backup_restore = async (req, res, next) => {
  try {
    const parsed = backupSchema.safeParse(req.body);
    if (!parsed.success) return error(res, 400, "Invalid backup data");
    const d = parsed.data;
    if (
      new Set(d.customers.map((x) => x.id)).size !== d.customers.length ||
      new Set(d.entries.map((x) => x.id)).size !== d.entries.length ||
      d.entries.some((x) => !d.customers.some((c) => c.id === x.customerId))
    )
      return error(
        res,
        400,
        "Backup contains duplicate or missing record references",
      );
    await restoreBackup({ shopId: req.shopId, user: req.user, data: d });
    res.status(204).end();
  } catch (e) {
    if (e.status) return error(res, e.status, e.message);
    next(e);
  }
};
