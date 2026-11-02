/**
 * Break-glass: put an account back on emailed sign-in codes when its owner has
 * lost their authenticator and no other admin can reset it from the dashboard
 * (the usual case for the only admin). Run on the host:
 *   docker compose exec app npx tsx scripts/reset-two-factor.ts <email>
 */
import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npx tsx scripts/reset-two-factor.ts <email>");
    process.exit(1);
  }

  const merchant = await prisma.merchant.findUnique({
    where: { email },
    select: { id: true, twoFactorMethod: true },
  });
  if (!merchant) {
    console.error(`[reset-two-factor] no account with email ${email}`);
    process.exit(1);
  }

  await prisma.$transaction([
    prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        twoFactorMethod: "email",
        totpSecret: null,
        totpPendingSecret: null,
        totpLastUsedStep: null,
      },
    }),
    prisma.adminAuditLog.create({
      data: {
        adminId: "cli",
        adminEmail: "scripts/reset-two-factor.ts",
        merchantId: merchant.id,
        action: "resetTwoFactor",
        details: { previousMethod: merchant.twoFactorMethod },
      },
    }),
  ]);
  console.log(`[reset-two-factor] ${email} now signs in with emailed codes`);
}

main()
  .catch((err) => {
    console.error("[reset-two-factor] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
