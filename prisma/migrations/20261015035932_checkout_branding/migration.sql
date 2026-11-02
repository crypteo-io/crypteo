-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "brandColor" TEXT;

-- CreateTable
CREATE TABLE "MerchantLogo" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merchantId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "MerchantLogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantLogo_merchantId_key" ON "MerchantLogo"("merchantId");

-- AddForeignKey
ALTER TABLE "MerchantLogo" ADD CONSTRAINT "MerchantLogo_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
