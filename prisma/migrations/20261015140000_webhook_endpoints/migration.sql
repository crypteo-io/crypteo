-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "webhookEndpointId" TEXT;

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "webhookEndpointId" TEXT;

-- AlterTable
ALTER TABLE "PaymentLink" ADD COLUMN     "webhookEndpointId" TEXT,
ADD COLUMN     "webhookUrl" TEXT;

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "merchantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_merchantId_url_key" ON "WebhookEndpoint"("merchantId", "url");

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: each merchant's Settings default URL becomes their default endpoint.
-- Merchant.defaultWebhookUrl is kept (unread) so the previous release keeps
-- working while the new one starts; drop it in a later migration.
INSERT INTO "WebhookEndpoint" ("id", "createdAt", "updatedAt", "merchantId", "url", "label", "isActive", "isDefault")
SELECT 'whe' || md5(random()::text || "id" || clock_timestamp()::text),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, "id", btrim("defaultWebhookUrl"), 'Default', true, true
FROM "Merchant"
WHERE "defaultWebhookUrl" IS NOT NULL AND btrim("defaultWebhookUrl") <> ''
ON CONFLICT ("merchantId", "url") DO NOTHING;
