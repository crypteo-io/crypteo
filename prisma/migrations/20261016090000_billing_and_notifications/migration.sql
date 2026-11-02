-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "billingHoldAt" TIMESTAMP(3),
ADD COLUMN     "feeExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "feeExemptAt" TIMESTAMP(3),
ADD COLUMN     "feeExemptBy" TEXT,
ADD COLUMN     "feeExemptReason" TEXT,
ADD COLUMN     "feesFromAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "billedInStatementId" TEXT,
ADD COLUMN     "feeForStatementId" TEXT;

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "feeTiers" JSONB NOT NULL,
    "feeMonthlyCapUsd" DOUBLE PRECISION,
    "feeMinInvoiceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "billingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "feesStartAt" TIMESTAMP(3),
    "billingMerchantId" TEXT,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeStatement" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "merchantId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "paymentCount" INTEGER NOT NULL,
    "volumeUsd" DOUBLE PRECISION NOT NULL,
    "ratePercent" DOUBLE PRECISION NOT NULL,
    "feeUsd" DOUBLE PRECISION NOT NULL,
    "carriedInUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountDueUsd" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "carriedIntoId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidPaymentId" TEXT,
    "resolvedBy" TEXT,
    "note" TEXT,
    "noticeIssuedAt" TIMESTAMP(3),
    "notice72hAt" TIMESTAMP(3),
    "notice24hAt" TIMESTAMP(3),
    "noticeHoldAt" TIMESTAMP(3),

    CONSTRAINT "FeeStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merchantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "ip" TEXT,
    "handledAt" TIMESTAMP(3),
    "handledBy" TEXT,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeStatement_status_dueAt_idx" ON "FeeStatement"("status", "dueAt");

-- CreateIndex
CREATE INDEX "FeeStatement_merchantId_createdAt_idx" ON "FeeStatement"("merchantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeeStatement_merchantId_periodStart_key" ON "FeeStatement"("merchantId", "periodStart");

-- CreateIndex
CREATE INDEX "Notification_merchantId_readAt_createdAt_idx" ON "Notification"("merchantId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_merchantId_createdAt_idx" ON "Notification"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactMessage_handledAt_createdAt_idx" ON "ContactMessage"("handledAt", "createdAt");

-- CreateIndex
CREATE INDEX "ContactMessage_createdAt_idx" ON "ContactMessage"("createdAt");

-- CreateIndex
CREATE INDEX "Payment_billedInStatementId_idx" ON "Payment"("billedInStatementId");

-- CreateIndex
CREATE INDEX "Payment_feeForStatementId_idx" ON "Payment"("feeForStatementId");

-- AddForeignKey
ALTER TABLE "FeeStatement" ADD CONSTRAINT "FeeStatement_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

