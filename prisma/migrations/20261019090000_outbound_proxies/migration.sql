-- Outbound proxies, managed on admin Proxies (previously the PROXIES env var).
CREATE TABLE "OutboundProxy" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastLatencyMs" INTEGER,
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "alertOpen" BOOLEAN NOT NULL DEFAULT false,
    "lastAlertAt" TIMESTAMP(3),

    CONSTRAINT "OutboundProxy_pkey" PRIMARY KEY ("id")
);
