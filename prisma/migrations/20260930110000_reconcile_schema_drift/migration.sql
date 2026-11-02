-- Catch-up for schema changes that reached production via `prisma db push`
-- and were never captured as migrations: payment links, test-mode flags,
-- email verification, and chain/token/wallet chosen at checkout. Production
-- already has every object below (its schema matched schema.prisma exactly on
-- 2026-09-30), so each statement is guarded and is a no-op there; on a fresh
-- database built from migrations it creates what is missing.

ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "isTest" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Merchant" ADD COLUMN IF NOT EXISTS "emailVerified" TIMESTAMP(3);

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "isTest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "paymentLinkId" TEXT;
-- The buyer picks the chain at checkout, so these start out null.
ALTER TABLE "Payment" ALTER COLUMN "chain" DROP NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "token" DROP NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "walletAddress" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "PaymentLink" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "merchantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "walletAddress" TEXT,
    "chain" TEXT,
    "token" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "paymentLimit" INTEGER,
    "paymentsCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentLink_merchantId_idx" ON "PaymentLink"("merchantId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payment_paymentLinkId_fkey') THEN
    ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "PaymentLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentLink_merchantId_fkey') THEN
    ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
