import { z } from "zod";
import { customerSchema } from "../validators/schemas.js";
import { customerOut } from "../utils/serializers.js";
import { error } from "../utils/http.js";
import {
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "../services/customersService.js";

export const handle_get_customers = async (req, res, next) => {
  try {
    const query = z
      .string()
      .trim()
      .max(80)
      .safeParse(req.query.q || "");
    if (!query.success) return error(res, 400, "Search query is too long");
    const limit = Math.min(
      500,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 30),
    );
    res.json(
      await listCustomers({
        shopId: req.shopId,
        query: query.data,
        cursorId: req.query.cursor,
        limit,
      }),
    );
  } catch (e) {
    next(e);
  }
};

export const handle_post_customers = async (req, res, next) => {
  try {
    const { audit, ...input } = req.body || {};
    const parsed = customerSchema.safeParse(input);
    if (!parsed.success) return error(res, 400, "Invalid customer");
    const doc = await createCustomer({
      shopId: req.shopId,
      actorId: req.user._id,
      customer: parsed.data,
      audit,
    });
    res.status(201).json(customerOut(doc));
  } catch (e) {
    if (e.status === 409) return res.status(409).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    next(e);
  }
};

export const handle_patch_customers_id = async (req, res, next) => {
  try {
    const { audit, baseRecord, ...input } = req.body || {};
    const hasBaseRecord = Object.hasOwn(req.body || {}, "baseRecord");
    const parsed = customerSchema.safeParse(input);
    if (!parsed.success || parsed.data.id !== req.params.id)
      return error(res, 400, "Invalid customer");
    const base = hasBaseRecord ? customerSchema.safeParse(baseRecord) : null;
    if (hasBaseRecord && (!base?.success || base.data.id !== req.params.id))
      return error(res, 400, "Invalid customer version");
    const doc = await updateCustomer({
      shopId: req.shopId,
      actorId: req.user._id,
      customer: parsed.data,
      base,
      audit,
    });
    res.json(customerOut(doc));
  } catch (e) {
    if (e.status === 404 || e.status === 409) return error(res, e.status, e.message);
    next(e);
  }
};

export const handle_delete_customers_id = async (req, res, next) => {
  try {
    const hasBaseRecord = Object.hasOwn(req.body || {}, "baseRecord");
    const base = hasBaseRecord
      ? customerSchema.safeParse(req.body.baseRecord)
      : null;
    if (hasBaseRecord && (!base?.success || base.data.id !== req.params.id))
      return error(res, 400, "Invalid customer version");
    await deleteCustomer({ shopId: req.shopId, id: req.params.id, base });
    res.status(204).end();
  } catch (e) {
    if (e.status === 404 || e.status === 409) return error(res, e.status, e.message);
    next(e);
  }
};
