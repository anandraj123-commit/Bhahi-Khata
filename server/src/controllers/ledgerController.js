import { z } from "zod";
import { idSchema, entrySchema } from "../validators/schemas.js";
import { digest } from "../utils/hashing.js";
import { error } from "../utils/http.js";
import {
  listLedger,
  listDeletedLedger,
  createLedgerEntry,
  deleteLedgerEntry,
  restoreLedgerEntry,
  updateLedgerEntry,
  resolveFinancialConflict,
} from "../services/ledgerService.js";

export const handle_get_deleted_ledger = async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const result = await listDeletedLedger({ shopId: req.shopId, customerId: req.query.customerId, cursorId: req.query.cursor, limit });
    res.json(result);
  } catch (e) { next(e); }
};

export const handle_get_ledger = async (req, res, next) => {
  try {
    const limit = Math.min(
      500,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 50),
    );
    res.json(
      await listLedger({
        shopId: req.shopId,
        customerId: req.query.customerId,
        month: req.query.month,
        cursorId: req.query.cursor,
        limit,
      }),
    );
  } catch (e) {
    next(e);
  }
};

export const handle_post_ledger = async (req, res, next) => {
  try {
    const { audit, ...input } = req.body || {};
    const parsed = entrySchema.safeParse(input);
    if (!parsed.success) return error(res, 400, "Invalid transaction");
    const key = req.get("Idempotency-Key");
    const result = await createLedgerEntry({
      shopId: req.shopId,
      actorId: req.user._id,
      entry: parsed.data,
      useServerRecordedAt: req.get("X-DK-Recorded-At-Authority") === "server",
      audit,
      key,
    });
    res.status(result.status).json(result.response);
  } catch (e) {
    if (e.status === 409 && e.code === "CUSTOMER_NOT_ACTIVE")
      return res.status(409).json({ error: e.message, code: e.code, type: "transaction_conflict", current: null, serverVersion: 1, resolutionVersion: 1 });
    if (e.status === 400 || e.status === 404 || e.status === 409)
      return error(res, e.status, e.message);
    next(e);
  }
};

export const handle_delete_ledger_id = async (req, res, next) => {
  try {
    if (req.body?.baseVersion !== undefined && !z.number().int().min(1).safeParse(req.body.baseVersion).success)
      return error(res, 400, "Invalid transaction version");
    if (req.body?.baseResolutionVersion !== undefined && !z.number().int().min(1).safeParse(req.body.baseResolutionVersion).success)
      return error(res, 400, "Invalid transaction resolution version");
    const hasBaseRecord = Object.hasOwn(req.body || {}, "baseRecord");
    const base = hasBaseRecord
      ? entrySchema.safeParse({ ...req.body.baseRecord, id: req.params.id })
      : null;
    if (hasBaseRecord && !base?.success)
      return error(res, 400, "Invalid transaction version");
    const body = req.body || {};
    const key = req.get("Idempotency-Key");
    const response = await deleteLedgerEntry({
      shopId: req.shopId,
      actorId: req.user._id,
      id: req.params.id,
      base,
      baseVersion: req.body?.baseVersion,
      baseResolutionVersion: req.body?.baseResolutionVersion,
      audit: body.audit,
      key,
      requestHash: key ? digest(JSON.stringify({ id: req.params.id, ...body })) : undefined,
    });
    if (!key) return res.status(204).end();
    res.json(response);
  } catch (e) {
    if (e.status === 404) return error(res, 404, e.message);
    if (e.status === 409)
      return res.status(409).json({
        error: e.message,
        ...(e.code ? { code: e.code } : {}),
        type: "transaction_conflict",
        current: e.current ?? null,
        serverVersion: e.serverVersion || e.current?.serverVersion || 1,
        resolutionVersion: e.resolutionVersion || e.current?.resolutionVersion || 1,
      });
    next(e);
  }
};

export const handle_post_ledger_id_restore = async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = z.object({
    expectedVersion: z.number().int().min(1),
    expectedResolutionVersion: z.number().int().min(1),
    audit: z.object({
      id: idSchema,
      action: z.literal("Restored transaction"),
      date: z.string().datetime(),
      before: entrySchema.optional(),
      after: entrySchema.optional(),
    }),
  }).strict().safeParse(req.body || {});
  const key = req.get("Idempotency-Key");
  const validationDetails = (issues = []) => issues.slice(0, 12).map((issue) => {
    const path = issue.path.map((part) => String(part));
    const unknownKeys = Array.isArray(issue.keys)
      ? issue.keys.slice(0, 8).filter((part) => /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(part))
      : [];
    return {
      field: [...path, ...unknownKeys].join(".").slice(0, 120) || "request",
      code: /^[a-z_]{1,40}$/.test(issue.code || "") ? issue.code : "invalid_value",
    };
  });
  if (!id.success)
    return res.status(400).json({ error: "Invalid restore request", code: "INVALID_TRANSACTION_RESTORATION", details: [{ field: "id", code: "invalid_format" }] });
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid restore request", code: "INVALID_TRANSACTION_RESTORATION", details: validationDetails(parsed.error.issues) });
  if (!key || key.length > 128)
    return res.status(400).json({ error: "Invalid restore request", code: "INVALID_TRANSACTION_RESTORATION", details: [{ field: "Idempotency-Key", code: "invalid_value" }] });
  const requestHash = digest(JSON.stringify({ id: id.data, ...parsed.data }));
  try {
    const entry = await restoreLedgerEntry({
      shopId: req.shopId,
      actorId: req.user._id,
      id: id.data,
      ...parsed.data,
      key,
      requestHash,
    });
    res.json(entry);
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    if (e.status === 409)
      return res.status(409).json({
        error: e.message,
        ...(e.code ? { code: e.code } : {}),
        type: "transaction_conflict",
        current: e.current ?? null,
        serverVersion: e.serverVersion || e.current?.serverVersion || 1,
        resolutionVersion: e.resolutionVersion || e.current?.resolutionVersion || 1,
      });
    next(e);
  }
};

export const handle_patch_ledger_id = async (req, res, next) => {
  try {
    const { audit, baseRecord, baseVersion, baseResolutionVersion, ...input } = req.body || {};
    if (baseVersion !== undefined && !z.number().int().min(1).safeParse(baseVersion).success)
      return error(res, 400, "Invalid transaction version");
    if (baseResolutionVersion !== undefined && !z.number().int().min(1).safeParse(baseResolutionVersion).success)
      return error(res, 400, "Invalid transaction resolution version");
    const hasBaseRecord = Object.hasOwn(req.body || {}, "baseRecord");
    const parsed = entrySchema.safeParse({ ...input, id: req.params.id });
    if (!parsed.success) return error(res, 400, "Invalid transaction");
    const base = hasBaseRecord
      ? entrySchema.safeParse({ ...baseRecord, id: req.params.id })
      : null;
    if (hasBaseRecord && !base?.success)
      return error(res, 400, "Invalid transaction version");
    const response = await updateLedgerEntry({
      shopId: req.shopId,
      actorId: req.user._id,
      entry: parsed.data,
      base,
      baseVersion,
      baseResolutionVersion,
      audit,
    });
    res.json(response);
  } catch (e) {
    if (e.status === 404) return error(res, 404, e.message);
    if (e.status === 409)
      return res.status(409).json({
        error: e.message,
        ...(e.code ? { code: e.code } : {}),
        type: "transaction_conflict",
        current: e.current ?? null,
        serverVersion: e.serverVersion || e.current?.serverVersion || 1,
        resolutionVersion: e.resolutionVersion || e.current?.resolutionVersion || 1,
      });
    next(e);
  }
};

export const handle_post_ledger_id_resolve = async (req, res, next) => {
  const parsed = z
    .object({
      resolutionId: idSchema,
      expectedVersion: z.number().int().min(1),
      expectedResolutionVersion: z.number().int().min(1).default(1),
      choice: z.enum(["keep_local", "keep_server"]),
      proposed: entrySchema,
      localDeleted: z.boolean().default(false),
      localAt: z.string().datetime().optional(),
    })
    .safeParse(req.body || {});
  if (!parsed.success || parsed.data.proposed.id !== req.params.id)
    return error(res, 400, "Invalid conflict resolution");
  const input = parsed.data;
  const key = `resolution:${input.resolutionId}`;
  const requestHash = digest(JSON.stringify(input));
  const conflictId = digest(
    JSON.stringify({
      transactionId: req.params.id,
      expectedVersion: input.expectedVersion,
      expectedResolutionVersion: input.expectedResolutionVersion,
    }),
  );
  try {
    res.json(
      await resolveFinancialConflict({
        shopId: req.shopId,
        actorId: req.user._id,
        transactionId: req.params.id,
        input,
        key,
        requestHash,
        conflictId,
      }),
    );
  } catch (e) {
    if (e.status === 409)
      return res.status(409).json({
        error: e.message,
        current: e.current ?? null,
        serverVersion: e.serverVersion || e.current?.serverVersion || 1,
        resolutionVersion: e.resolutionVersion || e.current?.resolutionVersion || 1,
      });
    next(e);
  }
};
