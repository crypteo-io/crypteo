/**
 * One-shot lifecycle notifier.
 * Usage: npx tsx scripts/notify.ts <service> <event>
 * event: "starting" | "shutdown"
 */
import "dotenv/config";
import { lifecycleHtml } from "../lib/emails/templates";
import { adminRecipients, sendAdminAlert } from "../lib/admin-alerts";

const [, , service = "Unknown", event = "starting"] = process.argv;

if (adminRecipients().length === 0) {
  console.log("[notify] No ADMIN_EMAILS set, skipping.");
  process.exit(0);
}

const isStarting = event === "starting";
const subject = isStarting
  ? `🟢 Crypteo ${service} Started`
  : `🟡 Crypteo ${service} Shutting Down`;

const timestamp = new Date().toISOString();

sendAdminAlert(
  subject,
  lifecycleHtml({
    service,
    event: isStarting ? "starting" : "shutdown",
    timestamp,
  }),
)
  .then((sent) => {
    console.log(`[notify] ${sent ? "Sent" : "FAILED"}: ${subject}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("[notify] Error:", err);
    process.exit(0); // never block the container from starting
  });
