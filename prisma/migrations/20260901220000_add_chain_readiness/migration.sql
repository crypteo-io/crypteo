-- Chain read-path readiness, probed by the worker.
-- A worker can be alive and polling while an RPC endpoint silently refuses the
-- methods a balance read depends on; without these columns that state is
-- indistinguishable from "no deposits have arrived".
ALTER TABLE "WorkerHeartbeat" ADD COLUMN "chainsCheckedAt" TIMESTAMP(3);
ALTER TABLE "WorkerHeartbeat" ADD COLUMN "chainsHealthy" BOOLEAN;
ALTER TABLE "WorkerHeartbeat" ADD COLUMN "chainsDegraded" TEXT;
