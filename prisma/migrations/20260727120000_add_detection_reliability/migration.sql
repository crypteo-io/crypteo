-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "firstDetectedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Payment_status_firstDetectedAt_idx" ON "Payment"("status", "firstDetectedAt");

-- Backfill: existing rows that already saw funds get an anchor so the
-- stuck-in-confirming timeout and the age-derived confirmation count have a
-- start point. updatedAt is refreshed by every poll and so is not usable here;
-- createdAt is immutable and is a conservative (never-too-late) lower bound.
UPDATE "Payment"
SET "firstDetectedAt" = "createdAt"
WHERE "firstDetectedAt" IS NULL
  AND ("receivedAmount" IS NOT NULL OR "status" = 'confirming');

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL DEFAULT 'worker',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastCycleAt" TIMESTAMP(3) NOT NULL,
    "cycleDuration" INTEGER NOT NULL DEFAULT 0,
    "pollsLastCycle" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
