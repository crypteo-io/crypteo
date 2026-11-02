import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

// A worker cycle runs every 10s. Past this it has missed many consecutive
// cycles — crashed, deadlocked, or lost the database.
const WORKER_STALE_MS = 120_000;

// Sessions sitting in "confirming" longer than this are not confirming any
// more, they're stuck. Surfaced so the monitor can alert well before the 24h
// timeout sweeps them.
const STUCK_CONFIRMING_MS = 6 * 60 * 60 * 1000;

// Balance reads that failed while opening a payment. Buyers saw only a generic
// retry message, so this window is how operators learn it happened at all.
const CHAIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

export async function GET() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;

    // Worker liveness. The worker has no HTTP surface of its own, so this
    // heartbeat row is the only way anything can tell it is still polling —
    // and a dead worker means deposits land on-chain undetected.
    const heartbeat = await prisma.workerHeartbeat.findUnique({
      where: { id: "worker" },
    });
    const workerAgeMs = heartbeat
      ? Date.now() - heartbeat.lastCycleAt.getTime()
      : null;
    const workerHealthy = workerAgeMs !== null && workerAgeMs < WORKER_STALE_MS;

    const stuckCutoff = new Date(Date.now() - STUCK_CONFIRMING_MS);
    const stuckConfirming = await prisma.payment.count({
      where: {
        status: "confirming",
        isTest: false,
        OR: [
          { firstDetectedAt: { lte: stuckCutoff } },
          { firstDetectedAt: null, createdAt: { lte: stuckCutoff } },
        ],
      },
    });

    const recentChainFailures = await prisma.chainReadFailure.count({
      where: {
        createdAt: { gte: new Date(Date.now() - CHAIN_FAILURE_WINDOW_MS) },
      },
    });

    const ms = Date.now() - start;

    // A stalled worker is reported as a degraded 200, not a 503: the web app is
    // serving fine, and failing this check would restart the app container
    // rather than the worker that actually needs attention. The monitor reads
    // the body and alerts on it.
    const chainsHealthy =
      heartbeat?.chainsHealthy !== false && recentChainFailures === 0;

    return NextResponse.json({
      status: workerHealthy && chainsHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseTime: `${ms}ms`,
      worker: {
        healthy: workerHealthy,
        lastCycleAt: heartbeat?.lastCycleAt.toISOString() ?? null,
        ageMs: workerAgeMs,
        pollsLastCycle: heartbeat?.pollsLastCycle ?? null,
        cycleDuration: heartbeat?.cycleDuration ?? null,
        // Deliberately a flag, not the message. This route is unauthenticated
        // and served publicly by nginx, and a driver error can carry the
        // datasource URL (credentials included). The text stays in
        // WorkerHeartbeat.lastError for operators with database access.
        hasError: Boolean(heartbeat?.lastError),
      },
      // A worker that cannot read a chain detects nothing while looking
      // healthy; this is where that distinction surfaces.
      chains: {
        healthy: heartbeat?.chainsHealthy ?? null,
        checkedAt: heartbeat?.chainsCheckedAt?.toISOString() ?? null,
        degraded: heartbeat?.chainsDegraded
          ? heartbeat.chainsDegraded.split(",")
          : [],
        // Count only. The messages name endpoints and can carry keys, and this
        // route is public — operators read the detail from ChainReadFailure.
        recentFailures: recentChainFailures,
      },
      payments: { stuckConfirming },
    });
  } catch {
    // Deliberately no queries here: this handler exists because the database is
    // unreachable.
    const ms = Date.now() - start;
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        responseTime: `${ms}ms`,
      },
      { status: 503 }
    );
  }
}
