ALTER TABLE "Merchant" ADD COLUMN "walletSlotsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "walletChangeVerifiedAt" TIMESTAMP(3);

-- Every slot that holds an address today has held one.
UPDATE "Merchant" m SET "walletSlotsUsed" = s.slots
FROM (
  SELECT "merchantId", array_agg(DISTINCT "chain" || ':' || "token") AS slots
  FROM "Wallet" GROUP BY "merchantId"
) s
WHERE s."merchantId" = m."id";
