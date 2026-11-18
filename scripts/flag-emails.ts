/**
 * Read-only: list live accounts whose email sign-up would now refuse or flag
 * (lib/email-quality.ts). The admin list flags blocklisted domains and
 * machine-made addresses without DNS; this also resolves each domain's MX,
 * which finds throwaway services behind a custom domain. Run on the host:
 *   docker compose exec app npx tsx scripts/flag-emails.ts
 */
import "dotenv/config";
import { DELETED_EMAIL_DOMAIN } from "../lib/account-state";
import { prisma } from "../lib/db";
import { isDisposableDomain, mailRoute, mxIsDisposable, suspiciousEmailReason } from "../lib/email-quality";

const MAX_ACCOUNTS = 5_000;

async function main() {
  const merchants = await prisma.merchant.findMany({
    where: { isActive: true, NOT: { email: { endsWith: DELETED_EMAIL_DOMAIN } } },
    select: { id: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: MAX_ACCOUNTS,
  });

  const domains = [...new Set(merchants.map((m) => m.email.slice(m.email.lastIndexOf("@") + 1)))];
  const throwawayMx = new Set<string>();
  for (const domain of domains) {
    if (isDisposableDomain(domain)) continue;
    const route = await mailRoute(domain);
    if (mxIsDisposable(route.serverNames)) throwawayMx.add(domain);
  }

  for (const m of merchants) {
    const domain = m.email.slice(m.email.lastIndexOf("@") + 1);
    const why = isDisposableDomain(domain)
      ? "disposable domain"
      : throwawayMx.has(domain)
        ? "throwaway mail server"
        : suspiciousEmailReason(m.email);
    if (why) console.log([m.createdAt.toISOString().slice(0, 10), m.id, m.role, m.email, why].join("\t"));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
