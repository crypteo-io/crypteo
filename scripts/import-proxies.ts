/**
 * One-off: copy the PROXIES env list (comma-separated, the old configuration)
 * into admin Proxies. Proxies already stored are skipped, so it is safe to
 * re-run. Prints hosts only, never credentials. Run on the host:
 *   docker compose exec app npx tsx scripts/import-proxies.ts
 * The app and worker pick the list up within a minute (lib/proxy-settings.ts).
 */
import "dotenv/config";
import { auditLog } from "../lib/admin";
import { prisma } from "../lib/db";
import { maskProxyUrl } from "../lib/proxy-rotation";
import { encryptProxyUrl, isDuplicateProxy, isProxyStorageAvailable, listProxies, parseProxyUrl } from "../lib/proxy-settings";

const ACTOR = { id: "script", email: "scripts/import-proxies.ts" };

async function main() {
  if (!isProxyStorageAvailable()) {
    console.error("TWO_FACTOR_ENCRYPTION_KEY is not configured: proxies can't be stored.");
    process.exit(1);
  }
  const entries = (process.env.PROXIES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (entries.length === 0) {
    console.log("PROXIES is empty: nothing to import.");
    return;
  }

  const stored = await listProxies();
  let added = 0;
  for (const entry of entries) {
    const parsed = parseProxyUrl(entry);
    if ("error" in parsed) {
      console.log(`  skipped ${maskProxyUrl(entry)}: ${parsed.error}`);
      continue;
    }
    if (isDuplicateProxy(stored, parsed.url)) {
      console.log(`  already stored ${maskProxyUrl(parsed.url)}`);
      continue;
    }
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.outboundProxy.create({
        data: { url: encryptProxyUrl(parsed.url), label: "Imported from PROXIES" },
      });
      await auditLog(tx, ACTOR, created.id, "proxy.create", { host: maskProxyUrl(parsed.url), source: "PROXIES" });
      return created;
    });
    stored.push({ ...row, url: parsed.url });
    added++;
    console.log(`  added ${maskProxyUrl(parsed.url)}`);
  }
  console.log(`Imported ${added} of ${entries.length} proxies.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
