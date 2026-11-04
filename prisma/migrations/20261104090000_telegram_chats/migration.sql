ALTER TABLE "Merchant" ADD COLUMN "telegramCodeHash" TEXT,
ADD COLUMN "telegramCodeExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Merchant_telegramCodeHash_key" ON "Merchant"("telegramCodeHash");

CREATE TABLE "TelegramChat" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merchantId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notifyPaid" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TelegramChat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramChat_chatId_key" ON "TelegramChat"("chatId");
CREATE INDEX "TelegramChat_merchantId_idx" ON "TelegramChat"("merchantId");

ALTER TABLE "TelegramChat" ADD CONSTRAINT "TelegramChat_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
