-- What Payment.balanceSnapshot measures. BTC snapshots switch from lifetime
-- received (funded_txo_sum, which counts change returned to the address as a
-- deposit) to the confirmed balance. Existing rows stay null and keep the
-- legacy comparison until they age out, so a session opened before the deploy
-- is never compared against a snapshot in different units.
ALTER TABLE "Payment" ADD COLUMN "snapshotBasis" TEXT;
