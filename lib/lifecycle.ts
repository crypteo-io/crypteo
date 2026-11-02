import { adminRecipients, sendLifecycleAlert } from "./admin-alerts";
import { lifecycleHtml } from "./emails/templates";

export async function registerLifecycle() {
  if (adminRecipients().length === 0) return;

  // Startup notification is handled by the monitor (consolidated stack report).
  // Only register shutdown handler here.
  const shutdown = async (signal: string) => {
    await sendLifecycleAlert(
      "🟡 Crypteo App Shutting Down",
      lifecycleHtml({
        service: "App Server",
        event: "shutdown",
        detail: `Signal: ${signal}.`,
        timestamp: new Date().toISOString(),
      }),
    ).catch(console.error);
  };

  // Node.js specific APIs
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
