import { Audit, FinancialResolution, Shop } from "../models.js";
import { auditOut, financialAuditOut } from "../utils/serializers.js";

export async function listActivity({ shopId, limit, token }) {
  let cursor = null;
  let cursorKind = "audit";
  let cursorId = token;
  if (token.startsWith("resolution:")) {
    cursorKind = "resolution";
    cursorId = token.slice("resolution:".length);
  } else if (token.startsWith("audit:")) {
    cursorId = token.slice("audit:".length);
  }
  if (cursorId) {
    cursor =
      cursorKind === "resolution"
        ? await FinancialResolution.findOne({ shopId, resolutionId: cursorId })
            .select("_id serverAt")
            .lean()
        : await Audit.findOne({ shopId, clientId: cursorId })
            .select("_id occurredAt")
            .lean();
  }
  const after = (field) =>
    cursor
      ? {
          $or: [
            {
              [field]: {
                $lt: cursor[cursorKind === "resolution" ? "serverAt" : "occurredAt"],
              },
            },
            {
              [field]: cursor[cursorKind === "resolution" ? "serverAt" : "occurredAt"],
              _id: { $lt: cursor._id },
            },
          ],
        }
      : {};
  const [auditRows, resolutionRows] = await Promise.all([
    Audit.find({ shopId, ...after("occurredAt") })
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
    FinancialResolution.find({ shopId, status: "resolved", ...after("serverAt") })
      .sort({ serverAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
  ]);
  const merged = [
    ...auditRows.map((row) => ({
      kind: "audit",
      sortAt: row.occurredAt,
      sortId: String(row._id),
      cursorId: row.clientId,
      row,
    })),
    ...resolutionRows.map((row) => ({
      kind: "resolution",
      sortAt: row.serverAt,
      sortId: String(row._id),
      cursorId: row.resolutionId,
      row,
    })),
  ].sort((a, b) => b.sortAt - a.sortAt || b.sortId.localeCompare(a.sortId));
  const more = merged.length > limit;
  const page = merged.slice(0, limit);
  const items = page.map((item) =>
    item.kind === "audit"
      ? auditOut(item.row)
      : financialAuditOut(item.row),
  );
  const last = page.at(-1);
  return {
    items,
    nextCursor: more && last ? `${last.kind}:${last.cursorId}` : null,
  };
}

export async function markActivityRead({ shopId, ids }) {
  return Shop.updateOne(
    { _id: shopId },
    { $addToSet: { readAuditIds: { $each: ids } } },
  );
}
