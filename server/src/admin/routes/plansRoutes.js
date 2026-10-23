import { Router } from "express";
import { permit, recentAuthentication } from "../middleware/security.js";
import { customerLimitUpdate, id, parse, planConfigurationUpdate } from "../validators/index.js";
import { listPlans, updatePlanConfiguration, updatePlanCustomerLimit } from "../services/plans.js";
const router = Router();

router.get("/", permit("plans:read"), async (_req, res) =>
  res.json({ data: await listPlans() }),
);

router.patch(
  "/:id/customer-limit",
  permit("plans:customer-limit"),
  async (req, res) => {
    const planId = parse(id, req.params.id);
    const input = parse(customerLimitUpdate, req.body);
    res.json({ data: await updatePlanCustomerLimit(req, planId, input) });
  },
);

router.patch(
  "/:id",
  permit("plans:manage"),
  recentAuthentication,
  async (req, res) => {
    const planId = parse(id, req.params.id);
    const input = parse(planConfigurationUpdate, req.body);
    res.json({ data: await updatePlanConfiguration(req, planId, input) });
  },
);

export default router;
