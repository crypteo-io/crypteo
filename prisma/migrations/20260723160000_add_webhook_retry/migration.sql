-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "nextWebhookRetryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Payment_nextWebhookRetryAt_idx" ON "Payment"("nextWebhookRetryAt");
