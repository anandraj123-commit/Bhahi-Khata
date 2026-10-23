import { Router } from "express";
import {
  customerFilters,
  customerShopFilters,
  customerStatementPeriod,
  customerTransactionFilters,
  id,
  parse,
} from "../validators/index.js";
import { permit } from "../middleware/security.js";
import {
  customerDetail,
  customerShopOptions,
  listCustomers,
} from "../services/customers.js";
import { audit } from "../services/audit.js";
import {
  customerFinancialSummary,
  customerStatement,
  customerTransactions,
} from "../services/customerFinancials.js";
const router = Router();

router.get(
  "/customers/:id/financial-summary",
  permit("customers:financial:read"),
  async (req, res) => {
    const customerId = parse(id, req.params.id);
    const result = await customerFinancialSummary(customerId);
    await audit(req, "customer.financial_summary.read", "customer", customerId, {
      shopId: result.customer.shopId,
    });
    res.json({ data: result });
  },
);

router.get(
  "/customers/:id/transactions",
  permit("customers:transactions:read"),
  async (req, res) => {
    const customerId = parse(id, req.params.id);
    const filters = parse(customerTransactionFilters, req.query);
    const result = await customerTransactions(customerId, filters);
    await audit(req, "customer.transactions.read", "customer", customerId, {
      page: String(filters.page),
      limit: String(filters.limit),
      type: filters.type || "all",
      status: filters.status || "all",
    });
    res.json(result);
  },
);

router.get(
  "/customers/:id/statement",
  permit("customers:statement:read"),
  async (req, res) => {
    const customerId = parse(id, req.params.id);
    const period = parse(customerStatementPeriod, req.query);
    const result = await customerStatement(customerId, period);
    await audit(req, "customer.statement.read", "customer", customerId, {
      from: period.from,
      to: period.to,
    });
    res.json({ data: result });
  },
);

router.get("/customers", permit("customers:read"), async (req, res) => {
  const filters = parse(customerFilters, req.query);
  const result = await listCustomers(filters);
  await audit(req, "customer.list", "customer_collection", undefined, {
    page: String(filters.page),
    limit: String(filters.limit),
    status: filters.status || "all",
  });
  res.json(result);
});

router.get("/customers/:id", permit("customers:read"), async (req, res) => {
  const customerId = parse(id, req.params.id);
  const customer = await customerDetail(customerId);
  await audit(req, "customer.view", "customer", customerId);
  res.json({ data: customer });
});

router.get("/shops/:shopId/customers", permit("customers:read"), async (req, res) => {
  const shopId = parse(id, req.params.shopId);
  const filters = parse(customerFilters, req.query);
  const result = await listCustomers(filters, shopId);
  await audit(req, "customer.shop_list", "shop", shopId, {
    page: String(filters.page),
    limit: String(filters.limit),
    status: filters.status || "all",
  });
  res.json(result);
});

router.get("/customer-shops", permit("customers:read"), async (req, res) => {
  const filters = parse(customerShopFilters, req.query);
  res.json(await customerShopOptions(filters));
});

export default router;
