-- Payments are the financial record; deleting a merchant must never take them
-- with it. Merchant self-delete is now a soft delete (isActive = false), and
-- the FK refuses a hard delete while any payment references the merchant.
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_merchantId_fkey";
-- NOT VALID + VALIDATE: the re-add doesn't hold a SHARE ROW EXCLUSIVE lock on
-- Payment while every existing row is checked.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Payment" VALIDATE CONSTRAINT "Payment_merchantId_fkey";

-- Sessions authenticated before this instant are revoked. Set on password
-- reset/change and on self-delete.
ALTER TABLE "Merchant" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

-- The seed script used to install a LIVE API key whose raw value
-- ("crypt_developer_123456789") is committed to the repository. Revoke it
-- wherever it was ever seeded; the seed now only creates random test keys.
UPDATE "ApiKey" SET "isActive" = false
WHERE "keyHash" = '1c5486a71ccf4a40f816d394e60546139e97c288dc1336139b3765622c9c83d1';

-- Same for the committed playground TEST key ("test_developer_123456789"): it
-- is public, so anyone could create sessions, simulate them and create payment
-- links as its merchant. Revoked by hash, like the live key above.
UPDATE "ApiKey" SET "isActive" = false
WHERE "keyHash" = 'c30d067d117f745167fcee26e5e6d8b5ba28ee9f5f2ae94167944d27afd0b942';

-- When balanceSnapshot was read. Attribution subtracts deposits credited to
-- other sessions after this instant; null (pre-existing rows) falls back to
-- createdAt.
ALTER TABLE "Payment" ADD COLUMN "snapshotAt" TIMESTAMP(3);
