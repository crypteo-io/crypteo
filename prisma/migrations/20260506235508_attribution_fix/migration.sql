-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "senderAddress" TEXT,
ADD COLUMN     "solMemoString" TEXT;

-- CreateTable
CREATE TABLE "OrphanTransaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txHash" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "receivedAmount" DOUBLE PRECISION NOT NULL,
    "blockTime" TIMESTAMP(3),
    "resolvedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "resolvedToPaymentId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "OrphanTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrphanTransaction_txHash_key" ON "OrphanTransaction"("txHash");

-- CreateIndex
CREATE INDEX "OrphanTransaction_walletAddress_chain_token_idx" ON "OrphanTransaction"("walletAddress", "chain", "token");

-- CreateIndex
CREATE INDEX "OrphanTransaction_resolvedByAdmin_idx" ON "OrphanTransaction"("resolvedByAdmin");

-- CreateIndex
CREATE INDEX "Payment_walletAddress_chain_token_status_idx" ON "Payment"("walletAddress", "chain", "token", "status");

