import { Router } from "express";
import { permit } from "../middleware/security.js";
import { filters, id, parse } from "../validators/index.js";
import * as read from "../services/readModels.js";
import { audit } from "../services/audit.js";
import { fail } from "../utils/security.js";
const router = Router();
function reportFilters(query) {
  const f = parse(filters, query);
  const end = f.to ? Date.parse(f.to) : Date.now();
  const start = f.from ? Date.parse(f.from) : end - 29 * 86400000;
  if (end - start > 365 * 86400000)
    throw fail(
      400,
      "ADMIN_DATE_RANGE_LIMIT",
      "Choose a date range of no more than one year",
    );
  return f;
}
router.get("/dashboard", permit("dashboard:read"), async (req, res) =>
  res.json({ data: await read.dashboard(reportFilters(req.query)) }),
);
router.get("/shops", permit("shops:read"), async (req, res) =>
  res.json(
    await read.shops(parse(filters, req.query), req.admin.role === "SUPPORT"),
  ),
);
router.get("/shops/:id", permit("shops:read"), async (req, res) =>
  res.json({
    data: await read.shopDetail(
      parse(id, req.params.id),
      req.admin.role === "SUPPORT",
    ),
  }),
);
router.get("/subscriptions", permit("subscriptions:read"), async (req, res) =>
  res.json(await read.subscriptions(parse(filters, req.query))),
);
router.get("/payments", permit("payments:read"), async (req, res) =>
  res.json(await read.payments(parse(filters, req.query))),
);
router.get("/audit-logs", permit("audit:read"), async (req, res) =>
  res.json(await read.auditLogs(parse(filters, req.query))),
);
router.get("/reports", permit("reports:read"), async (req, res) =>
  res.json({ data: await read.dashboard(reportFilters(req.query), false) }),
);
router.get("/reports/export", permit("reports:read"), async (req, res) => {
  const report = await read.dashboard(reportFilters(req.query), false);
  await audit(req, "report.export", "report", undefined);
  res
    .set(
      "Content-Disposition",
      'attachment; filename="digital-khata-report.csv"',
    )
    .type("text/csv")
    .send(read.reportCsv(report));
});
export default router;
