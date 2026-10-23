import cron from "node-cron";
import { subscriptionConfig } from "./config/env.js";
import { log as logger, safeErrorContext } from "./config/logger.js";
import { reconcilePendingCashfreePayments } from "./services/subscriptionService.js";

export function startPaymentReconciliationWorker(log = logger) {
  if (!subscriptionConfig.checkoutEnabled) {
    log.info("Cashfree payment reconciliation worker disabled");
    return;
  }
  cron.schedule(
    "*/5 * * * *",
    async () => {
      try {
        const result = await reconcilePendingCashfreePayments({ limit: 20 });
        if (result.attempted > 0) {
          log.info(result, "Cashfree payment reconciliation completed");
        }
      } catch (error) {
        log.error(safeErrorContext(error), "Cashfree payment reconciliation failed");
      }
    },
    { noOverlap: true },
  );
  log.info("Cashfree payment reconciliation worker enabled");
}
