ALTER TABLE "Merchant" ADD COLUMN "supportEmail" TEXT,
ADD COLUMN "supportLinkLabel" TEXT,
ADD COLUMN "supportLinkUrl" TEXT,
ADD COLUMN "showPoweredBy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "customDomain" TEXT,
ADD COLUMN "customDomainToken" TEXT,
ADD COLUMN "customDomainVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Merchant_customDomain_key" ON "Merchant"("customDomain");
