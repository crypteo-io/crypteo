-- Balance reads that failed while opening a payment. Buyers get a generic
-- retry message, so the cause has to be recorded somewhere operators can see.
CREATE TABLE "ChainReadFailure" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chain" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    CONSTRAINT "ChainReadFailure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChainReadFailure_createdAt_idx" ON "ChainReadFailure"("createdAt");
