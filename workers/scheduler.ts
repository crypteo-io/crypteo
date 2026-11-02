import cron from "node-cron";
import { checkChainReadiness } from "../lib/chains/health";
import { prisma } from "../lib/db";
import {
  chainDegradedHtml,
  lifecycleHtml,
  workerCrashHtml,
} from "../lib/emails/templates";
import { sendAdminAlert, sendLifecycleAlert } from "../lib/admin-alerts";
import { GRACE_PERIOD_MS, TOPUP_WINDOW_MS } from "../lib/payment/match";
import { deliverWebhook } from "../lib/payment/notify";
import { expireStalePending, timeoutStaleConfirming } from "./expiry";
import { newReadCache } from "../lib/chains/reads";
import { pollPayment } from "./poll";
import { runBillingCycle, runCycleClose } from "../lib/billing/run";
import { purgeOldNotifications } from "../lib/notifications";
import { purgeUnverifiedSignups } from "../lib/otp";
import { checkAllProxies } from "../lib/proxy-health";
import { startProxySync } from "../lib/proxy-settings";

const inFlight = new Set<string>();
let shuttingDown = false;

async function notify(subject: string, html: string) {
  await sendAdminAlert(subject, html).catch(console.error);
}

// ─── CRON: every 10 seconds ───────────────────────────────────────────────────

/**
 * Stamp the liveness beacon read by /api/health and the monitor.
 *
 * The worker is the only thing that detects payments and it exposes no HTTP
 * surface, so without this a stalled or crashed worker is invisible: sessions
 * simply stop being polled and quietly expire while deposits land on-chain.
 * Failures here are logged and swallowed — a heartbeat write must never take
 * down the poll cycle it is reporting on.
 */
async function recordHeartbeat(
  startedAt: number,
  pollCount: number,
  error?: unknown,
) {
  const data = {
    lastCycleAt: new Date(),
    cycleDuration: Date.now() - startedAt,
    pollsLastCycle: pollCount,
    lastError: error
      ? String(error instanceof Error ? error.message : error).slice(0, 500)
      : null,
  };
  try {
    await prisma.workerHeartbeat.upsert({
      where: { id: "worker" },
      create: { id: "worker", ...data },
      update: data,
    });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Heartbeat write failed:`,
      err,
    );
  }
}

// ─── CHAIN READINESS ──────────────────────────────────────────────────────────

/**
 * Can each chain/token pair's balance actually be read right now? The worker
 * being alive says nothing about whether it can see deposits; this is the
 * difference between "no deposits arrived" and "we are blind".
 */
let lastDegradedKey = "";

async function probeChainReadiness(reason: string) {
  const report = await checkChainReadiness();
  const degradedKey = report.degraded.join(",");

  try {
    await prisma.workerHeartbeat.upsert({
      where: { id: "worker" },
      create: {
        id: "worker",
        lastCycleAt: new Date(),
        chainsCheckedAt: new Date(report.checkedAt),
        chainsHealthy: report.healthy,
        chainsDegraded: degradedKey || null,
      },
      update: {
        chainsCheckedAt: new Date(report.checkedAt),
        chainsHealthy: report.healthy,
        chainsDegraded: degradedKey || null,
      },
    });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Chain readiness write failed:`,
      err,
    );
  }

  if (report.healthy) {
    if (lastDegradedKey) {
      console.log(
        `[${report.checkedAt}] Chain readiness recovered (was: ${lastDegradedKey})`,
      );
    }
    lastDegradedKey = "";
    return;
  }

  console.error(
    `[${report.checkedAt}] CHAIN READ FAILURE (${reason}): cannot read: ${degradedKey}`,
  );
  for (const pair of report.pairs.filter((p) => !p.ok)) {
    console.error(`  ${pair.chain}/${pair.token}: ${pair.error}`);
  }

  // Once per distinct set of broken pairs, not once per probe.
  if (degradedKey === lastDegradedKey) return;
  lastDegradedKey = degradedKey;

  await notify(
    `🔴 Crypteo: cannot read ${report.degraded.join(", ")}`,
    chainDegradedHtml({
      degraded: report.pairs
        .filter((p) => !p.ok)
        .map((p) => ({
          pair: `${p.chain}/${p.token}`,
          error: p.error || "unknown",
        })),
      healthy: report.pairs.filter((p) => p.ok).map((p) => `${p.chain}/${p.token}`),
      timestamp: report.checkedAt,
    }),
  );
}

// Proxy health for admin Proxies: a real request through each saved proxy.
const PROXY_CHECK_CRON = process.env.PROXY_CHECK_CRON || "*/5 * * * *";
let checkingProxies = false;
cron.schedule(PROXY_CHECK_CRON, async () => {
  if (shuttingDown || checkingProxies) return;
  checkingProxies = true;
  try {
    await checkAllProxies();
  } catch (err) {
    console.error("Proxy health check error:", err);
  } finally {
    checkingProxies = false;
  }
});

// Every 15 minutes, plus once at startup: the window in which we are blind and
// unaware must be far shorter than the time a merchant takes to complain.
const CHAIN_PROBE_CRON = process.env.CHAIN_PROBE_CRON || "*/15 * * * *";

cron.schedule(CHAIN_PROBE_CRON, async () => {
  if (shuttingDown) return;
  await probeChainReadiness("hourly").catch((err) =>
    console.error("Chain readiness probe error:", err),
  );
});

cron.schedule("*/10 * * * * *", async () => {
  if (shuttingDown) return;
  const now = new Date();
  const cycleStart = Date.now();

  try {
    const payments = await prisma.payment.findMany({
      where: {
        isTest: false,
        nextPollAt: { lte: now },
        OR: [
          { status: { in: ["pending", "confirming"] } },
          // Underpaid sessions stay pollable within the top-up window so a
          // follow-up deposit can complete the invoice. Keyed off the immutable
          // expiresAt (updatedAt is refreshed by every poll).
          {
            status: "underpaid",
            expiresAt: { gt: new Date(now.getTime() - TOPUP_WINDOW_MS) },
          },
        ],
      },
      include: { merchant: { select: { underpaidThreshold: true } } },
      take: 50,
    });

    // Recently-expired sessions still inside the grace window: poll them
    // promptly (not just hourly) so a late deposit can be attributed as
    // expired_received before the grace window closes.
    const graceExpired = await prisma.payment.findMany({
      where: {
        status: "expired",
        txHash: null,
        isTest: false,
        expiresAt: { gt: new Date(now.getTime() - GRACE_PERIOD_MS) },
      },
      include: { merchant: { select: { underpaidThreshold: true } } },
      take: 50,
    });

    const byId = new Map<string, (typeof payments)[number]>();
    for (const p of [...payments, ...graceExpired]) byId.set(p.id, p);
    const eligible = [...byId.values()].filter((p) => !inFlight.has(p.id));
    for (const p of eligible) inFlight.add(p.id);

    // One read per wallet per cycle, shared by every session on it.
    const reads = newReadCache();
    await Promise.allSettled(
      eligible.map(async (p) => {
        try {
          await pollPayment(p, reads);
        } finally {
          inFlight.delete(p.id);
        }
      }),
    );

    await recordHeartbeat(cycleStart, eligible.length);
  } catch (err) {
    // The cycle itself failed — the DB query threw, or something outside the
    // per-payment error handling did. Record it on the heartbeat so the monitor
    // can surface a worker that is running but not actually polling. Swallowed
    // rather than rethrown: a transient DB blip shouldn't kill the worker, and
    // a persistent one now shows up as a stale/erroring heartbeat.
    console.error(`[${now.toISOString()}] Poll cycle error:`, err);
    await recordHeartbeat(cycleStart, 0, err);
  }
});

// ─── CRON: session auto-expiry — every 2 minutes ──────────────────────────────
// Runs well inside GRACE_PERIOD_MS so a session is flipped to "expired" promptly
// after expiresAt, leaving most of the grace window available for the fast loop
// above to still catch a late deposit (expired_received). Each expiry fires the
// merchant webhook (see ./expiry).

cron.schedule("*/2 * * * *", async () => {
  if (shuttingDown) return;
  const now = new Date();

  try {
    const expired = await expireStalePending(now);
    if (expired.length > 0) {
      console.log(
        `[${now.toISOString()}] Auto-expired ${expired.length} stale payment session(s)`,
      );
    }
  } catch (err) {
    console.error(`[${now.toISOString()}] Session auto-expiry error:`, err);
  }
});

// ─── CRON: confirming timeout — every 15 minutes ──────────────────────────────
// Payments stuck in "confirming" for more than 24 hours are timed out, since
// confirmation should complete well within that window. See
// timeoutStaleConfirming for why this keys off firstDetectedAt and why funded
// sessions become expired_received.

cron.schedule("*/15 * * * *", async () => {
  if (shuttingDown) return;
  const now = new Date();

  try {
    const { received, expired } = await timeoutStaleConfirming(now);
    if (expired.length > 0 || received.length > 0) {
      console.log(
        `[${now.toISOString()}] Timed out stale confirming payment(s) (>24h): ${received.length} expired_received, ${expired.length} expired`,
      );
    }
  } catch (err) {
    console.error(
      `[${now.toISOString()}] Confirming timeout auto-expiry error:`,
      err,
    );
  }
});

// ─── CRON: expired watch — hourly ─────────────────────────────────────────────

cron.schedule("0 * * * *", async () => {
  if (shuttingDown) return;
  const now = new Date();
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

  const expiredWatchPayments = await prisma.payment.findMany({
    where: {
      status: "expired",
      expiresAt: { gte: twelveHoursAgo },
      isTest: false,
    },
    include: { merchant: { select: { underpaidThreshold: true } } },
  });

  const eligible = expiredWatchPayments.filter((p) => !inFlight.has(p.id));
  for (const p of eligible) inFlight.add(p.id);

  const reads = newReadCache();
  await Promise.allSettled(
    eligible.map(async (p) => {
      try {
        await pollPayment(p, reads);
      } finally {
        inFlight.delete(p.id);
      }
    }),
  );
});

// ─── CRON: rate-limit table cleanup — hourly ─────────────────────────────────
// Purge expired rate-limit buckets so the table stays bounded.

cron.schedule("30 * * * *", async () => {
  if (shuttingDown) return;
  try {
    const result = await prisma.rateLimit.deleteMany({
      where: { resetAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      console.log(
        `[${new Date().toISOString()}] Purged ${result.count} expired rate-limit bucket(s)`,
      );
    }
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Rate-limit cleanup error:`,
      err,
    );
  }
});

// ─── CRON: webhook retry — every minute ───────────────────────────────────────
// Re-deliver merchant webhooks whose previous attempt failed and whose backoff
// has elapsed. deliverWebhook advances the attempt counter and reschedules (or
// gives up once the backoff schedule is exhausted).

cron.schedule("* * * * *", async () => {
  if (shuttingDown) return;
  const now = new Date();

  try {
    const due = await prisma.payment.findMany({
      where: {
        nextWebhookRetryAt: { lte: now },
        isTest: false,
      },
      take: 50,
    });

    for (const p of due) {
      await deliverWebhook(p);
    }

    if (due.length > 0) {
      console.log(
        `[${now.toISOString()}] Retried ${due.length} pending webhook(s)`,
      );
    }
  } catch (err) {
    console.error(`[${now.toISOString()}] Webhook retry error:`, err);
  }
});

// ─── CRON: platform fees — every 2 minutes, month close hourly ───────────────
// The cycle settles paid invoices (and lifts holds) within minutes of a fee
// checkout confirming, places holds and sends reminders. The month close is
// idempotent and runs hourly so a worker that was down at midnight on the 1st
// still closes the month (lib/billing/statements.ts).

let billingBusy = false;
cron.schedule("*/2 * * * *", async () => {
  if (shuttingDown || billingBusy) return;
  billingBusy = true;
  try {
    const r = await runBillingCycle(new Date());
    if (r.settled || r.held || r.notices || r.lifted || r.finalized) {
      console.log(`[${new Date().toISOString()}] Billing:`, r);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Billing cycle error:`, err);
  } finally {
    billingBusy = false;
  }
});

cron.schedule("5 * * * *", async () => {
  if (shuttingDown || billingBusy) return;
  billingBusy = true;
  try {
    const r = await runCycleClose(new Date());
    if (r.created || r.errors.length) {
      console.log(`[${new Date().toISOString()}] Fee close: ${r.created} statement(s), ${r.invoiced} invoiced, ${r.errors.length} failed`);
    }
    const purged = await purgeOldNotifications();
    if (purged) console.log(`[${new Date().toISOString()}] Purged ${purged} old notification(s)`);
    const signups = await purgeUnverifiedSignups();
    if (signups) console.log(`[${new Date().toISOString()}] Removed ${signups} unverified sign-up(s)`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Fee close error:`, err);
  } finally {
    billingBusy = false;
  }
});

// ─── CRASH HANDLERS ───────────────────────────────────────────────────────────

async function notifyAdminCrash(type: string, err: unknown) {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(`[WORKER CRASH] ${type}:`, error);
  await notify(
    `🔴 Crypteo Worker Crash: ${type}`,
    workerCrashHtml({
      type,
      message: error.message,
      stack: error.stack || "N/A",
      timestamp: new Date().toISOString(),
    }),
  );
}

process.on("uncaughtException", (err) => {
  notifyAdminCrash("uncaughtException", err);
  setTimeout(() => process.exit(1), 3000);
});

process.on("unhandledRejection", (reason) => {
  notifyAdminCrash("unhandledRejection", reason);
  // Exit so the orchestrator restarts us into a known-good state, mirroring the
  // uncaughtException handler. The delay lets the crash email flush first.
  setTimeout(() => process.exit(1), 3000);
});

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] Received ${signal}, shutting down gracefully...`);
  shuttingDown = true;

  await sendLifecycleAlert(
    "🟡 Crypteo Worker Shutting Down",
    lifecycleHtml({
      service: "Payment Worker",
      event: "shutdown",
      detail: `Signal: ${signal}. Draining ${inFlight.size} in-flight poll(s).`,
      timestamp: ts,
    }),
  ).catch(console.error);

  const deadline = Date.now() + 30_000;
  while (inFlight.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }

  await prisma.$disconnect();
  console.log(`[${new Date().toISOString()}] Worker shutdown complete.`);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── STARTUP ──────────────────────────────────────────────────────────────────

const startTs = new Date().toISOString();
console.log(
  `[${startTs}] Worker scheduler started and listening for payments...`,
);

// Proxies first (admin Proxies, refreshed every minute), so the probe reads
// the way the poll cycles will. Then, before the first poll cycle: a deploy
// that breaks an endpoint should be caught in seconds, not by a merchant
// reporting a missing payment.
startProxySync()
  .then(() => probeChainReadiness("startup"))
  .catch((err) => console.error("Startup chain readiness probe error:", err));
