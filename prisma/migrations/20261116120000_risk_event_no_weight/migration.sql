-- Any probe now suspends a merchant account: events no longer carry a score.
ALTER TABLE "AccountRiskEvent" DROP COLUMN "weight";
