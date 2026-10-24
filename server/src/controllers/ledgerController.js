import { z } from "zod";
import { idSchema, entrySchema } from "../validators/schemas.js";
import { digest } from "../utils/hashing.js";
import { error } from "../utils/http.js";
import {
  listLedger,
  createLedgerEntry,
  deleteLedgerEntry,
  updateLedgerEntry,
  resolveFinancialConflict,
} from "../services/ledgerService.js";

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
    await deleteLedgerEntry({
      shopId: req.shopId,
      actorId: req.user._id,
      id: req.params.id,
      base,
      baseVersion: req.body?.baseVersion,
      baseResolutionVersion: req.body?.baseResolutionVersion,
      audit: req.body?.audit,
    });
    res.status(204).end();
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
