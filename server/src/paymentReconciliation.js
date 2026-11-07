import { reconcileRefundBacklog } from "./services/paymentRefunds.js";
import { retryPaymentWebhooks } from "./services/paymentWebhookInbox.js";
import cron from "node-cron";
import { subscriptionConfig } from "./config/env.js";
import { log as logger, safeErrorContext } from "./config/logger.js";
import { reconcilePendingCashfreePayments } from "./services/subscriptionService.js";

export function startPaymentReconciliationWorker(log = logger, {
  config = subscriptionConfig, schedule = cron.schedule.bind(cron), reconcile = reconcilePendingCashfreePayments,
} = {}) {
  // Stopping new charges must not stop verification of existing purchases.
  if (!config.cashfreeClientId || !config.cashfreeClientSecret) {
    log.warn("Cashfree payment reconciliation disabled: verification credentials unavailable");
    return;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      // Injected reconcilers remain independent for scheduling-only tests.
      if (reconcile === reconcilePendingCashfreePayments) {
        try {
          const inbox = await retryPaymentWebhooks({ limit: 20 });
          if (inbox.queued) log.warn(inbox, "Payment webhook recovery backlog requires attention");
        } catch (error) { log.error(safeErrorContext(error), "Payment webhook recovery failed; order polling continues"); }
      }
      const result = await reconcile({ limit: 20 });
      log.info(result, "Cashfree payment reconciliation completed");
      if (reconcile === reconcilePendingCashfreePayments) await reconcileRefundBacklog({ limit: 20 });
    } catch (error) {
      log.error(safeErrorContext(error), "Cashfree payment reconciliation failed");
    } finally { running = false; }
  };
  const task = schedule("*/5 * * * *", run, { noOverlap: true });
  log.info("Cashfree payment reconciliation worker enabled (startup and every five minutes)");
  const ready = run();
  return { task, ready, run };
}
