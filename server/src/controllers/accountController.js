import { z } from "zod";
import { error } from "../utils/http.js";
import { deleteAccount } from "../services/accountService.js";

export const handle_post_account_delete = async (req, res, next) => {
  try {
    const confirm = z.literal("DELETE").safeParse(req.body?.confirm);
    if (!confirm.success) return error(res, 400, "Confirmation required");
    await deleteAccount({ userId: req.user._id, shopId: req.shopId });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
};
