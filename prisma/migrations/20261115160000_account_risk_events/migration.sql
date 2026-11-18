-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT,
ADD COLUMN     "suspensionNote" TEXT;

-- CreateTable
CREATE TABLE "AccountRiskEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merchantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "AccountRiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountRiskEvent_merchantId_createdAt_idx" ON "AccountRiskEvent"("merchantId", "createdAt");

-- AddForeignKey
ALTER TABLE "AccountRiskEvent" ADD CONSTRAINT "AccountRiskEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
