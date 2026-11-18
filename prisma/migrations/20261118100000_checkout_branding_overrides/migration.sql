-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "brandName" TEXT,
ADD COLUMN     "showSupportEmail" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "branding" JSONB;
