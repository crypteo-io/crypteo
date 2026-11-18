-- CreateTable
CREATE TABLE "WebhookFailureNotice" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookFailureNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookFailureNotice_merchantId_url_key" ON "WebhookFailureNotice"("merchantId", "url");

-- AddForeignKey
ALTER TABLE "WebhookFailureNotice" ADD CONSTRAINT "WebhookFailureNotice_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
