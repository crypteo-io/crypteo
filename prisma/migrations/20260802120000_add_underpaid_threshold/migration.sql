-- Per-merchant underpaid threshold (received/expected ratio for "fully paid").
ALTER TABLE "Merchant" ADD COLUMN "underpaidThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.99;
