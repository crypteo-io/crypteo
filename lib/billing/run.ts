import { sendAdminAlert } from "../admin-alerts";
import { monitorFindingHtml } from "../emails/templates";
import { notifyAdmins } from "../notifications";
import { notifyHoldLifted, notifyStatementPaid, sendDueNotices } from "./notices";
import {
  closeDueCycles,
  finalizeDrafts,
  liftBillingHolds,
  placeBillingHolds,
  settleFeePayments,
  type CloseReport,
} from "./statements";

/**
 * The frequent billing pass (worker, every few minutes): finish drafts, settle
 * paid invoices, hold overdue merchants, send due notices, lift settled holds.
 * Holds and notices apply to open invoices even while monthly billing is
 * switched off; an admin waives an invoice to drop it.
 */
export async function runBillingCycle(now: Date = new Date()) {
  const finalized = await finalizeDrafts(now);
  const settled = await settleFeePayments(now);
  for (const id of settled) await notifyStatementPaid(id, "checkout");
  const held = await placeBillingHolds(now);
  const notices = await sendDueNotices(now);
  const lifted = await liftBillingHolds(now);
  for (const id of lifted) await notifyHoldLifted(id);
  return { finalized, settled: settled.length, held: held.length, notices, lifted: lifted.length };
}

/** Close every merchant billing month that has ended (idempotent; hourly). */
export async function runCycleClose(now: Date = new Date()): Promise<CloseReport> {
  const report = await closeDueCycles(now);
  if (report.errors.length > 0) {
    const detail = `${report.errors.length} merchant statement(s) could not be created: ${report.errors
      .slice(0, 10)
      .map((e) => `${e.merchantId}: ${e.error}`)
      .join("; ")}`;
    await sendAdminAlert(
      "⚠️ Fee statements failed",
      monitorFindingHtml({
        title: "Billing cycle close failed",
        check: "Billing month close",
        detail,
        timestamp: now.toISOString(),
      }),
    ).catch(console.error);
    await notifyAdmins({
      kind: "admin_billing_error",
      title: "Fee statements need attention",
      body: `${report.errors.length} merchant statement(s) failed; it retries hourly. Details were emailed to the admin alert list.`,
      link: "/revenue",
    });
  }
  return report;
}
