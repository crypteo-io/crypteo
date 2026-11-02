import { existsSync } from "fs";
import path from "path";
import { sendEmail } from "./mailer";

/**
 * The only recipients of operational mail: outages, poll failures, orphans,
 * crashes, lifecycle and monitor reports. Read at call time so a changed
 * ADMIN_EMAILS applies on restart. Never a merchant's address: an alert names
 * endpoints, stack traces and other merchants' payments. The guard test in
 * lib/admin-alerts.test.ts fails if anything else reads ADMIN_EMAILS.
 */
export function adminRecipients(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

/** Email an operational alert to ADMIN_EMAILS. False when none are set or it failed. */
export async function sendAdminAlert(subject: string, html: string): Promise<boolean> {
  const to = adminRecipients();
  if (to.length === 0) return false;
  const result = await sendEmail({ to: to.join(","), subject, html });
  return result.success;
}

/**
 * True while deploy.sh runs: it creates `.deploy-state/planned`, mounted into
 * every container, so a deploy's restarts aren't reported as if they were an
 * outage. Only restart notices check it; failure alerts always go out.
 */
export function plannedRestart(): boolean {
  return existsSync(path.join(process.cwd(), ".deploy-state", "planned"));
}

/** A service's start or shutdown notice: skipped during a planned deploy. */
export async function sendLifecycleAlert(subject: string, html: string): Promise<boolean> {
  if (plannedRestart()) {
    console.log(`[lifecycle] planned deploy, not emailed: ${subject}`);
    return false;
  }
  return sendAdminAlert(subject, html);
}
