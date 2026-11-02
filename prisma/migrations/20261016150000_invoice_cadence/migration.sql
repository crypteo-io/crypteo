-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN "feeMonthlyInvoiceUsd" DOUBLE PRECISION DEFAULT 100,
ADD COLUMN "feeInvoiceEveryMonths" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "FeeStatement" ADD COLUMN "accruingSince" TIMESTAMP(3);
