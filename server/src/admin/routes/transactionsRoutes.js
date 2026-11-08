import { Router } from "express";
import { permit } from "../middleware/security.js";
import { id, parse } from "../validators/index.js";
import { transactionFilters } from "../validators/transactions.js";
import {
  globalTransactions,
  transactionDetail,
} from "../services/transactions.js";
import { audit } from "../services/audit.js";
const router = Router();
const access = [
  "shops:read",
  "customers:read",
  "customers:financial:read",
  "customers:transactions:read",
].map(permit);
router.get("/transactions", ...access, async (req, res) => {
  const f = parse(transactionFilters, req.query);
  const data = await globalTransactions(f);
  await audit(req, "transaction.list", "ledger_collection", undefined, {
    page: String(f.page),
    limit: String(f.limit),
  });
  res.json({ data });
});
router.get("/transactions/:id", ...access, async (req, res) => {
  const transactionId = parse(id, req.params.id);
  const data = await transactionDetail(transactionId);
  await audit(req, "transaction.view", "ledger_entry", transactionId, {
    shopId: String(data.transaction.shopId),
  });
  res.json({ data });
});
export default router;
