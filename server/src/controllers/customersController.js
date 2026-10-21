import { z } from "zod";
import { customerConflictSchema, customerCreateSchema, customerLifecycleSchema, customerSchema } from "../validators/schemas.js";
import { customerOut } from "../utils/serializers.js";
import { digest } from "../utils/hashing.js";
import { error } from "../utils/http.js";
import {
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  resolveCustomerConflict,
  transitionCustomer,
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
    const parsed = customerCreateSchema.safeParse(input);
    if (!parsed.success) return error(res, 400, "Invalid customer");
    const doc = await createCustomer({
      shopId: req.shopId,
      actorId: req.user._id,
      customer: parsed.data,
      audit,
    });
    res.status(201).json(customerOut(doc));
  } catch (e) {
    if (e.status === 409 && e.code === "CUSTOMER_MOBILE_ALREADY_EXISTS")
      return res.status(409).json({ error: e.message, code: e.code });
    if (e.status === 409 && e.current !== undefined)
      return res.status(409).json({ error: e.message, type: "customer_conflict", current: e.current, serverVersion: e.serverVersion || e.current?.serverVersion || 1, resolutionVersion: e.resolutionVersion || e.current?.resolutionVersion || 1 });
    if (e.status === 409) return res.status(409).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    next(e);
  }
};

export const handle_patch_customers_id = async (req, res, next) => {
  try {
    const { audit, baseRecord, baseVersion, baseResolutionVersion, ...input } = req.body || {};
    if (baseVersion !== undefined && !z.number().int().min(1).safeParse(baseVersion).success)
      return error(res, 400, "Invalid customer version");
    if (baseResolutionVersion !== undefined && !z.number().int().min(1).safeParse(baseResolutionVersion).success)
      return error(res, 400, "Invalid customer resolution version");
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
      baseVersion,
      baseResolutionVersion,
      audit,
    });
    res.json(customerOut(doc));
  } catch (e) {
    if (e.status === 404) return error(res, 404, e.message);
    if (e.status === 409 && e.code === "CUSTOMER_MOBILE_ALREADY_EXISTS")
      return res.status(409).json({ error: e.message, code: e.code });
    if (e.status === 409 && e.current !== undefined)
      return res.status(409).json({ error: e.message, type: "customer_conflict", current: e.current ?? null, serverVersion: e.serverVersion || e.current?.serverVersion || 1, resolutionVersion: e.resolutionVersion || e.current?.resolutionVersion || 1 });
    if (e.status === 409) return res.status(409).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    next(e);
  }
};

export const handle_delete_customers_id = async (req, res, next) => {
  try {
    const hasBaseRecord = Object.hasOwn(req.body || {}, "baseRecord");
    const baseVersion = req.body?.baseVersion;
    const baseResolutionVersion = req.body?.baseResolutionVersion;
    if (baseVersion !== undefined && !z.number().int().min(1).safeParse(baseVersion).success)
      return error(res, 400, "Invalid customer version");
    if (baseResolutionVersion !== undefined && !z.number().int().min(1).safeParse(baseResolutionVersion).success)
      return error(res, 400, "Invalid customer resolution version");
    const base = hasBaseRecord
      ? customerSchema.safeParse(req.body.baseRecord)
      : null;
    if (hasBaseRecord && (!base?.success || base.data.id !== req.params.id))
      return error(res, 400, "Invalid customer version");
    await deleteCustomer({ shopId: req.shopId, actorId: req.user._id, id: req.params.id, base, baseVersion, baseResolutionVersion, audit: req.body?.audit });
    res.status(204).end();
  } catch (e) {
    if (e.status === 404) return error(res, 404, e.message);
    if (e.status === 409 && e.current !== undefined)
      return res.status(409).json({ error: e.message, type: "customer_conflict", current: e.current ?? null, serverVersion: e.serverVersion || e.current?.serverVersion || 1, resolutionVersion: e.resolutionVersion || e.current?.resolutionVersion || 1 });
    if (e.status === 409) return res.status(409).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    next(e);
  }
};

export const handle_post_customer_id_resolve = async (req, res, next) => {
  const parsed = customerConflictSchema.safeParse(req.body || {});
  if (!parsed.success || parsed.data.proposed.id !== req.params.id)
    return error(res, 400, "Invalid customer conflict resolution");
  const input = parsed.data;
  const key = `customer-resolution:${input.resolutionId}`;
  const requestHash = digest(JSON.stringify(input));
  const conflictId = digest(JSON.stringify({
    customerId: req.params.id,
    expectedVersion: input.expectedVersion,
    expectedResolutionVersion: input.expectedResolutionVersion,
  }));
  try {
    res.json(await resolveCustomerConflict({
      shopId: req.shopId,
      actorId: req.user._id,
      customerId: req.params.id,
      input,
      key,
      requestHash,
      conflictId,
    }));
  } catch (e) {
    if (e.status === 409)
      return res.status(409).json({ error: e.message, ...(e.current !== undefined ? { type: "customer_conflict", current: e.current, serverVersion: e.serverVersion || e.current?.serverVersion || 1, resolutionVersion: e.resolutionVersion || e.current?.resolutionVersion || 1 } : {}), ...(e.code ? { code: e.code } : {}), ...(e.audit ? { audit: e.audit } : {}) });
    next(e);
  }
};

export const handle_patch_customer_lifecycle = async (req, res, next) => {
  const parsed = customerLifecycleSchema.safeParse(req.body || {});
  if (!parsed.success) return error(res, 400, "Invalid customer status change");
  try {
    res.json(await transitionCustomer({
      shopId: req.shopId,
      actorId: req.user._id,
      customerId: req.params.id,
      ...parsed.data,
    }));
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: e.message, code: e.code });
    if (e.status === 409) return res.status(409).json({
      error: e.message,
      code: e.code || "CUSTOMER_STATUS_CONFLICT",
      ...(e.current !== undefined ? { type: "customer_conflict", current: e.current } : {}),
      ...(e.serverVersion ? { serverVersion: e.serverVersion } : {}),
      ...(e.resolutionVersion ? { resolutionVersion: e.resolutionVersion } : {}),
    });
    next(e);
  }
};
