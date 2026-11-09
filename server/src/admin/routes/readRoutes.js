import { monitoringKind, monitoringFilters } from "../validators/paymentMonitoring.js";
import { paymentMonitoring } from "../services/paymentMonitoring.js";
import { Router } from "express";
import {
  permit,
  recentAuthentication,
  loginLimit,
} from "../middleware/security.js";
import { filters, id, parse } from "../validators/index.js";
import * as read from "../services/readModels.js";
import { audit } from "../services/audit.js";
import { PaymentOrder, PaymentOrderRecovery } from "../../models.js";
import { verifyPayment } from "../../services/subscriptionService.js";
import { fail } from "../utils/security.js";
import { shopFinancials } from "../services/shopFinancials.js";
import { financialFilters } from "../validators/shopFinancials.js";
import {
  paymentOrderFilters,
  orderRecordFilters,
} from "../validators/paymentOrders.js";
import {
  listPaymentOrders,
  paymentOrderDetail,
  paymentOrderRecords,
  paymentAttemptDetail,
} from "../services/paymentOrders.js";
const router = Router();
for (const detail of [false, true])
  router.get(
    `/shops/:id/financial-${detail ? "records" : "overview"}`,
    permit("shops:read"),
    permit("customers:read"),
    permit("customers:financial:read"),
    permit("customers:transactions:read"),
    async (req, res) => {
      const shopId = parse(id, req.params.id);
      const f = detail ? parse(financialFilters, req.query) : null;
      const result = await shopFinancials(shopId, f);
      await audit(req, "shop.financial.read", "shop", shopId, {
        view: f?.view || "overview",
        page: String(f?.page || 1),
      });
      res.json({ data: result });
    },
  );
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

router.get("/payment-orders", permit("payments:read"), async (req, res) =>
  res.json(await listPaymentOrders(parse(paymentOrderFilters, req.query))),
);
router.post(
  "/payment-orders/:id/reconcile",
  permit("payments:reconcile"),
  recentAuthentication,
  loginLimit,
  async (req, res) => {
    const orderId = parse(id, req.params.id);
    const order =
      (await PaymentOrder.findOne({
        _id: orderId,
        appMode: process.env.APP_MODE,
      })
        .select("shopId")
        .lean()) ||
      (await PaymentOrderRecovery.findOne({
        _id: orderId,
        appMode: process.env.APP_MODE,
      })
        .select("shopId")
        .lean());
    if (!order)
      throw fail(404, "ADMIN_ORDER_NOT_FOUND", "Payment order not found");
    await audit(
      req,
      "payment.reconciliation.requested",
      "payment_order",
      orderId,
    );
    try {
      const result = await verifyPayment({ shopId: order.shopId, orderId });
      await audit(
        req,
        "payment.reconciliation.completed",
        "payment_order",
        orderId,
        { status: result.status },
      );
      res.json({ data: { status: result.status } });
    } catch (error) {
      await audit(
        req,
        "payment.reconciliation.failed",
        "payment_order",
        orderId,
        {},
        undefined,
        "failure",
      );
      throw fail(
        503,
        "ADMIN_RECONCILIATION_UNAVAILABLE",
        "Authoritative verification could not complete. The payment reference is retained.",
      );
    }
  },
);

router.get(
  "/payment-recovery-events",
  permit("payments:read"),
  async (req, res) =>
    res.json(await read.paymentRecoveryEvents(parse(filters, req.query))),
);
router.get(
  "/payment-recovery-snapshots",
  permit("payments:read"),
  async (req, res) =>
    res.json(await read.paymentRecoverySnapshots(parse(filters, req.query))),
);

router.get("/payment-refunds", permit("payments:read"), async (req, res) =>
  res.json(await read.paymentRefunds(parse(filters, req.query))),
);
router.get("/payment-health", permit("payments:read"), async (req, res) =>
  res.json({ data: await read.paymentHealth() }),
);

router.get("/payment-orders/:id", permit("payments:read"), async (req, res) =>
  res.json({ data: await paymentOrderDetail(parse(id, req.params.id)) }),
);
router.get(
  "/payment-orders/:id/records",
  permit("payments:read"),
  async (req, res) => {
    const f = parse(orderRecordFilters, req.query);
    if (
      ["audit", "adminAudit"].includes(f.kind) &&
      !req.adminPermissions.includes("audit:read")
    )
      throw fail(
        403,
        "ADMIN_PERMISSION_DENIED",
        "Audit permission is required",
      );
    res.json(await paymentOrderRecords(parse(id, req.params.id), f));
  },
);
router.get("/payments/:id", permit("payments:read"), async (req, res) =>
  res.json({ data: await paymentAttemptDetail(parse(id, req.params.id)) }),
);

router.get("/payment-monitoring/:kind", permit("payments:read"), async (req, res) =>
  res.json(await paymentMonitoring(parse(monitoringKind, req.params.kind), parse(monitoringFilters, req.query))),
);
