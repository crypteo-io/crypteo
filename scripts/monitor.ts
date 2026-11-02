import "dotenv/config";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as tls from "tls";
import {
  authErrorsHtml,
  probeTrafficHtml,
  backupFailureHtml,
  checkFailureHtml,
  dbErrorHtml,
  monitorFindingHtml,
  routineReportHtml,
  serviceDownHtml,
  serviceRecoveredHtml,
  slowdownHtml,
  stackStartupHtml,
  stuckPaymentsHtml,
  workerStalledHtml,
  type ServiceStartupStatus,
} from "../lib/emails/templates";
import { adminRecipients, sendAdminAlert } from "../lib/admin-alerts";
import { isScannerHit, parseAccessLine, ProbeWindow, ScannerTally, type ProbeOffender } from "../lib/probe-traffic";


const APP_URL = "http://app:3000/api/health";
// Port 80 only ever redirects to HTTPS, so on its own it proves nothing about
// the path buyers use — any status, even a 301 from a broken TLS server block,
// used to count as "up". The real check is the HTTPS probe below.
const NGINX_HTTP_URL = "http://nginx:80/";
const NGINX_HOST = "nginx";
// The public hostname, sent as SNI/Host so nginx picks the production server
// block and presents the production certificate.
const PUBLIC_HOSTNAME = (() => {
  try {
    return new URL(process.env.NEXTAUTH_URL || "").hostname || "crypteo.io";
  } catch {
    return "crypteo.io";
  }
})();
// Alert this long before the origin certificate expires. Cloudflare keeps
// serving its edge certificate, so an expired origin cert fails as a 526 on
// every request rather than a browser warning anyone would notice first.
const CERT_WARN_DAYS = 14;
const NGINX_LOG = "/var/log/nginx/access.log";
// First read of the access log (monitor start) looks back at most this far, so
// a large unrotated log is never slurped whole; later reads take only new bytes.
const LOG_INITIAL_TAIL_BYTES = 1024 * 1024;
const LOG_MAX_READ_BYTES = 8 * 1024 * 1024;
const AUTH_ERROR_WINDOW_MS = 5 * 60 * 1000;
const AUTH_ERROR_THRESHOLD = 5;
const PROBE_WINDOW_MS = 10 * 60 * 1000;
// Client errors on the API from one IP in the window. A signed-in dashboard
// makes a handful; the 2026-10-23 prober made 90 in three minutes.
const PROBE_THRESHOLD = 40;
// At most one probe email per this; offenders in between join the next one.
const PROBE_ALERT_EVERY_MS = 60 * 60 * 1000;
// Written by postgres/backup.sh after each run; mounted read-only here.
const BACKUP_STATUS_FILE = "/backups/last_backup.json";
// Nightly cron at 02:00, so a healthy backup is never more than ~24h old. The
// extra 2h absorbs a slow dump without crying wolf.
const BACKUP_MAX_AGE_MS = 26 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 60_000;
// The probe runs every 15 minutes; past this it has missed several and the
// data must not be trusted as a pass.
const CHAIN_PROBE_STALE_MS = 50 * 60 * 1000;
const REPORT_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000;
const SLOWDOWN_THRESHOLD_MS = 3000;
const SLOWDOWN_CONSECUTIVE = 3;
const FAIL_CONSECUTIVE = 2;

interface CheckState {
  failures: number;
  slowdowns: number;
  alertedDown: boolean;
  totalChecks: number;
  totalFailures: number;
  lastResponseTime: number;
}

const state: Record<string, CheckState> = {
  app: {
    failures: 0,
    slowdowns: 0,
    alertedDown: false,
    totalChecks: 0,
    totalFailures: 0,
    lastResponseTime: 0,
  },
  nginx: {
    failures: 0,
    slowdowns: 0,
    alertedDown: false,
    totalChecks: 0,
    totalFailures: 0,
    lastResponseTime: 0,
  },
};

let lastResetDay = new Date().getUTCDate();

// Latest chain readiness seen from /api/health, for the routine report.
let lastChains: HealthBody["chains"] = undefined;

// Latch flags so a persistent condition alerts once, not every 60s. Each is
// cleared when the condition clears, which re-arms the alert.
const alerted = {
  worker: false,
  chains: false,
  chainProbeStale: false,
  chainReadFailures: false,
  stuckPayments: false,
  backup: false,
  authErrors: false,
  // IPs already reported for probe traffic; one drops out (and re-arms) once
  // it falls back under the threshold.
  probeIps: new Set<string>(),
  // Scanner paths already reported as served with content.
  scannerHitPaths: new Set<string>(),
  cert: false,
  checks: new Set<string>(),
};

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function httpGet(
  url: string,
  timeoutMs = 5000
): Promise<{ status: number; body: string; elapsed: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let settled = false;
    const done = (val: { status: number; body: string; elapsed: number }) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };
    const timer = setTimeout(() => {
      req.destroy();
      fail(new Error("timeout"));
    }, timeoutMs);
    const req = http.get(url, (res) => {
      const status = res.statusCode ?? 0;
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        clearTimeout(timer);
        done({ status, body, elapsed: Date.now() - start });
      });
      res.on("error", fail);
    });
    req.on("error", fail);
  });
}

/**
 * GET https://nginx<path> as a public client would reach it: SNI and Host set
 * to the public hostname.
 *
 * Chain verification is off because the origin certificate is issued by
 * Cloudflare's Origin CA, which is deliberately not in any public trust store
 * (only Cloudflare's edge trusts it), and the in-network name "nginx" is not on
 * it anyway. What verification would have caught — the wrong certificate, or
 * an expiring one — is checked explicitly by checkCertificate.
 */
function httpsGet(
  path: string,
  timeoutMs = 5000
): Promise<{
  status: number;
  body: string;
  elapsed: number;
  cert: tls.PeerCertificate | null;
}> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let settled = false;
    const req = https.get(
      {
        host: NGINX_HOST,
        port: 443,
        path,
        servername: PUBLIC_HOSTNAME,
        headers: { Host: PUBLIC_HOSTNAME, "User-Agent": "crypteo-monitor" },
        rejectUnauthorized: false,
        // A pooled socket would skip the handshake and hand back no certificate.
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const socket = res.socket as tls.TLSSocket;
        const peer = socket.getPeerCertificate?.();
        const cert = peer && Object.keys(peer).length ? peer : null;
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            resolve({ status, body, elapsed: Date.now() - start, cert });
          }
        });
        res.on("error", fail);
      }
    );
    const fail = (err: Error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    };
    const timer = setTimeout(() => {
      req.destroy();
      fail(new Error("timeout"));
    }, timeoutMs);
    req.on("error", fail);
  });
}

/**
 * Probe nginx the way the internet reaches it: the port-80 listener must
 * redirect, and HTTPS on the public hostname must serve a 200 from
 * /api/health. Throws with the reason on either failure.
 */
async function probeNginx(): Promise<{
  elapsed: number;
  cert: tls.PeerCertificate | null;
}> {
  const plain = await httpGet(NGINX_HTTP_URL);
  if (plain.status < 300 || plain.status >= 400) {
    throw new Error(`port 80 answered HTTP ${plain.status}, expected a redirect`);
  }
  const secure = await httpsGet("/api/health");
  if (secure.status !== 200) {
    throw new Error(`https://${PUBLIC_HOSTNAME}/api/health via nginx → HTTP ${secure.status}`);
  }
  return { elapsed: secure.elapsed, cert: secure.cert };
}

async function sendAlert(subject: string, html: string) {
  if (adminRecipients().length === 0) {
    log(`[ALERT] No ADMIN_EMAILS set, skipping: ${subject}`);
    return;
  }
  log(`[ALERT] Sending: ${subject}`);
  const sent = await sendAdminAlert(subject, html);
  log(`[ALERT] Email ${sent ? "sent" : "FAILED"}: ${subject}`);
}

async function checkApp() {
  const s = state.app;
  s.totalChecks++;
  try {
    const { status, body, elapsed } = await httpGet(APP_URL);
    s.lastResponseTime = elapsed;
    log(`[CHECK] app → HTTP ${status} in ${elapsed}ms`);

    if (status !== 200) throw new Error(`HTTP ${status}`);

    if (s.alertedDown) {
      s.alertedDown = false;
      s.failures = 0;
      await sendAlert(
        "✅ Crypteo App Recovered",
        serviceRecoveredHtml({
          service: "App Server",
          responseTime: elapsed,
          timestamp: new Date().toISOString(),
        })
      );
    } else {
      s.failures = 0;
    }

    if (elapsed > SLOWDOWN_THRESHOLD_MS) {
      s.slowdowns++;
      log(
        `[CHECK] app slowdown ${s.slowdowns}/${SLOWDOWN_CONSECUTIVE} (${elapsed}ms)`
      );
      if (s.slowdowns >= SLOWDOWN_CONSECUTIVE) {
        await sendAlert(
          "⚠️ Crypteo App Slowdown",
          slowdownHtml({
            service: "App Server",
            responseTime: elapsed,
            consecutiveCount: s.slowdowns,
            threshold: SLOWDOWN_THRESHOLD_MS,
            timestamp: new Date().toISOString(),
          })
        );
        s.slowdowns = 0;
      }
    } else {
      s.slowdowns = 0;
    }

    try {
      const json = JSON.parse(body);
      if (json.status === "error") {
        await sendAlert(
          "🔴 Crypteo DB Error",
          dbErrorHtml({ timestamp: new Date().toISOString() })
        );
      }
      await inspectWorkerHealth(json);
    } catch (err) {
      log(`[CHECK] health body parse/inspect failed: ${err}`);
    }
  } catch (err) {
    s.failures++;
    s.totalFailures++;
    log(`[CHECK] app FAILED (${s.failures}/${FAIL_CONSECUTIVE}): ${err}`);
    if (s.failures >= FAIL_CONSECUTIVE && !s.alertedDown) {
      s.alertedDown = true;
      await sendAlert(
        "🔴 Crypteo App Down",
        serviceDownHtml({
          service: "App Server",
          failures: s.failures,
          error: String(err),
          timestamp: new Date().toISOString(),
        })
      );
    }
  }
}

interface HealthBody {
  worker?: {
    healthy?: boolean;
    lastCycleAt?: string | null;
    ageMs?: number | null;
    // A flag, not the message — /api/health is public and the raw driver error
    // can carry credentials. Operators read the text from WorkerHeartbeat.
    hasError?: boolean;
  };
  chains?: {
    healthy?: boolean | null;
    checkedAt?: string | null;
    degraded?: string[];
    recentFailures?: number;
  };
  payments?: { stuckConfirming?: number };
}

/**
 * Alert on the conditions that mean deposits are going undetected while every
 * HTTP surface still looks perfectly healthy: the worker has stopped polling,
 * it cannot read a chain, or payments are piling up in "confirming".
 */
async function inspectWorkerHealth(json: HealthBody) {
  const worker = json.worker;
  if (worker) {
    if (worker.healthy === false) {
      log(`[CHECK] worker STALLED (heartbeat age ${worker.ageMs ?? "n/a"}ms)`);
      if (!alerted.worker) {
        alerted.worker = true;
        await sendAlert(
          "⛔ Crypteo Worker Stalled: payments not being detected",
          workerStalledHtml({
            lastCycleAt: worker.lastCycleAt ?? null,
            ageMs: worker.ageMs ?? null,
            lastError: worker.hasError
              ? "The last poll cycle recorded an error. See the worker logs, or WorkerHeartbeat.lastError in the database, for the message."
              : null,
            timestamp: new Date().toISOString(),
          })
        );
      }
    } else if (worker.healthy === true) {
      if (alerted.worker) {
        alerted.worker = false;
        await sendAlert(
          "✅ Crypteo Worker Recovered",
          serviceRecoveredHtml({
            service: "Payment Worker",
            responseTime: worker.ageMs ?? 0,
            timestamp: new Date().toISOString(),
          })
        );
      }
      log(`[CHECK] worker → OK (heartbeat age ${worker.ageMs ?? 0}ms)`);
    }
  }

  // A chain the worker cannot read detects nothing while uptime, heartbeat and
  // error logs all stay green.
  const chains = json.chains;
  lastChains = chains;
  if (chains?.healthy === false) {
    const pairs = (chains.degraded ?? []).join(", ") || "unknown pair(s)";
    log(`[CHECK] chain reads FAILING for ${pairs}`);
    if (!alerted.chains) {
      alerted.chains = true;
      await sendAlert(
        `⛔ Crypteo cannot read ${pairs}: deposits going undetected`,
        monitorFindingHtml({
          title: "Chain Reads Failing",
          check: `chain balance reads (${pairs})`,
          detail:
            "The worker's readiness probe could not read a balance for these chain/token pairs. Deposits on them will not be detected. See the worker logs for the per-endpoint error, then repoint the relevant *_RPC_URLS environment variable.",
          timestamp: chains.checkedAt ?? new Date().toISOString(),
        })
      );
    }
  } else if (chains?.healthy === true) {
    if (alerted.chains) {
      alerted.chains = false;
      await sendAlert(
        "✅ Crypteo Chain Reads Recovered",
        serviceRecoveredHtml({
          service: "Chain balance reads",
          responseTime: 0,
          timestamp: new Date().toISOString(),
        })
      );
    }
    log("[CHECK] chain reads → OK");
  }

  // Balance reads that failed while a buyer was opening a payment. They were
  // shown a generic retry message, so this is the only outward sign.
  const recentFailures = chains?.recentFailures ?? 0;
  if (recentFailures > 0) {
    log(`[CHECK] ${recentFailures} chain read failure(s) in the last 15min`);
    if (!alerted.chainReadFailures) {
      alerted.chainReadFailures = true;
      await sendAlert(
        `⚠️ Crypteo could not read wallet balances (${recentFailures} in 15min)`,
        monitorFindingHtml({
          title: "Payments Could Not Be Opened",
          check: "wallet balance reads during payment creation",
          detail: `${recentFailures} payment(s) could not be opened in the last 15 minutes because a wallet balance could not be read. Buyers saw a generic "try again shortly" message and no funds were requested. The per-failure cause is in the ChainReadFailure table; check the relevant *_RPC_URLS provider.`,
          timestamp: new Date().toISOString(),
        })
      );
    }
  } else if (alerted.chainReadFailures) {
    alerted.chainReadFailures = false;
    log("[CHECK] chain read failures cleared");
  }

  // A green flag is only meaningful if it is recent; a stopped probe reports a
  // stale memory as current fact.
  const probeAgeMs = chains?.checkedAt
    ? Date.now() - new Date(chains.checkedAt).getTime()
    : null;
  const probeStale = probeAgeMs === null || probeAgeMs > CHAIN_PROBE_STALE_MS;

  if (probeStale) {
    log(
      `[CHECK] chain readiness probe STALE (age ${probeAgeMs ?? "never run"}ms)`
    );
    if (!alerted.chainProbeStale) {
      alerted.chainProbeStale = true;
      await sendAlert(
        "⚠️ Crypteo chain readiness probe has stopped reporting",
        monitorFindingHtml({
          title: "Chain Probe Not Reporting",
          check: "chain readiness probe",
          detail:
            probeAgeMs === null
              ? "The worker has never reported chain readiness. It may be running a build from before the probe existed, or the probe is failing before it can write. Deposits could be going undetected with nothing to say so."
              : `Last probe was ${Math.round(probeAgeMs / 60000)} minutes ago; it runs every 15. The readiness status being served is stale and must not be read as healthy.`,
          timestamp: new Date().toISOString(),
        })
      );
    }
  } else if (alerted.chainProbeStale) {
    alerted.chainProbeStale = false;
    log("[CHECK] chain readiness probe reporting again");
  }

  const stuck = json.payments?.stuckConfirming ?? 0;
  if (stuck > 0) {
    log(`[CHECK] ${stuck} payment(s) stuck in confirming`);
    if (!alerted.stuckPayments) {
      alerted.stuckPayments = true;
      await sendAlert(
        `⏳ Crypteo: ${stuck} payment(s) stuck in confirming`,
        stuckPaymentsHtml({ count: stuck, timestamp: new Date().toISOString() })
      );
    }
  } else {
    alerted.stuckPayments = false;
  }
}

/**
 * Verify the nightly dump actually ran and succeeded. backup.sh writes its
 * outcome to a status file; a missing, failed, or stale file all mean there is
 * no recent restore point.
 */
async function checkBackups() {
  let lastBackupAt: string | null = null;
  let lastStatus: string | null = null;
  let sizeBytes: number | null = null;
  let reason: string | null = null;

  try {
    const raw = fs.readFileSync(BACKUP_STATUS_FILE, "utf8");
    const parsed = JSON.parse(raw) as {
      status?: string;
      timestamp?: string;
      sizeBytes?: number;
      error?: string;
      // Set by backup.sh's optional BACKUP_OFFSITE_CMD hook; "disabled" or
      // absent when no offsite destination is configured.
      offsite?: string;
      offsiteError?: string;
    };
    lastBackupAt = parsed.timestamp ?? null;
    lastStatus = parsed.status ?? null;
    sizeBytes = parsed.sizeBytes ?? null;

    if (parsed.status !== "ok") {
      reason = parsed.error || `last run reported "${parsed.status}"`;
    } else if (!parsed.timestamp) {
      reason = "status file has no timestamp";
    } else {
      const age = Date.now() - new Date(parsed.timestamp).getTime();
      if (!Number.isFinite(age)) {
        reason = "status file has an unreadable timestamp";
      } else if (age > BACKUP_MAX_AGE_MS) {
        reason = `last successful backup was ${Math.round(age / 3600_000)}h ago`;
      } else if (parsed.offsite === "failed") {
        // The local dump is fine, but the only copy is on this host.
        reason = `local backup OK but the offsite copy failed: ${parsed.offsiteError || "no detail"}`;
      }
    }
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    reason = missing
      ? "no backup has ever completed (status file missing)"
      : `status file unreadable: ${err}`;
  }

  if (reason) {
    log(`[CHECK] backup UNHEALTHY: ${reason}`);
    if (!alerted.backup) {
      alerted.backup = true;
      await sendAlert(
        "💾 Crypteo Backup Failing",
        backupFailureHtml({
          reason,
          lastBackupAt,
          lastStatus,
          sizeBytes,
          timestamp: new Date().toISOString(),
        })
      );
    }
    return;
  }

  log(`[CHECK] backup → OK (${lastBackupAt})`);
  if (alerted.backup) {
    alerted.backup = false;
    await sendAlert(
      "✅ Crypteo Backup Recovered",
      serviceRecoveredHtml({
        service: "PostgreSQL Backup",
        responseTime: 0,
        timestamp: new Date().toISOString(),
      })
    );
  }
}

async function checkNginx() {
  const s = state.nginx;
  s.totalChecks++;
  try {
    const { elapsed } = await probeNginx();
    s.lastResponseTime = elapsed;
    log(`[CHECK] nginx → HTTPS 200 in ${elapsed}ms`);

    if (s.alertedDown) {
      s.alertedDown = false;
      s.failures = 0;
      await sendAlert(
        "✅ Crypteo Nginx Recovered",
        serviceRecoveredHtml({
          service: "Nginx Proxy",
          responseTime: elapsed,
          timestamp: new Date().toISOString(),
        })
      );
    } else {
      s.failures = 0;
    }
  } catch (err) {
    s.failures++;
    s.totalFailures++;
    log(`[CHECK] nginx FAILED (${s.failures}/${FAIL_CONSECUTIVE}): ${err}`);
    if (s.failures >= FAIL_CONSECUTIVE && !s.alertedDown) {
      s.alertedDown = true;
      await sendAlert(
        "🔴 Crypteo Nginx Down",
        serviceDownHtml({
          service: "Nginx Proxy",
          failures: s.failures,
          error: String(err),
          timestamp: new Date().toISOString(),
        })
      );
    }
  }
}

/**
 * The origin certificate must cover the public hostname and not be close to
 * expiry. Runs its own handshake so it reports even when the app behind nginx
 * is down.
 */
async function checkCertificate() {
  const { cert } = await httpsGet("/api/health", 10_000);
  let reason: string | null = null;

  if (!cert) {
    reason = "nginx presented no certificate";
  } else {
    const mismatch = tls.checkServerIdentity(PUBLIC_HOSTNAME, cert);
    const expiresAt = new Date(cert.valid_to).getTime();
    const daysLeft = (expiresAt - Date.now()) / 86_400_000;
    if (mismatch) {
      reason = `certificate does not cover ${PUBLIC_HOSTNAME}: ${mismatch.message}`;
    } else if (!Number.isFinite(daysLeft)) {
      reason = `certificate has an unreadable expiry (${cert.valid_to})`;
    } else if (daysLeft < CERT_WARN_DAYS) {
      reason =
        daysLeft <= 0
          ? `certificate EXPIRED on ${cert.valid_to}`
          : `certificate expires in ${Math.floor(daysLeft)} day(s), on ${cert.valid_to}`;
    } else {
      log(`[CHECK] certificate → OK (${Math.floor(daysLeft)} days left)`);
    }
  }

  if (reason) {
    log(`[CHECK] certificate UNHEALTHY: ${reason}`);
    if (!alerted.cert) {
      alerted.cert = true;
      await sendAlert(
        "🔐 Crypteo TLS Certificate Problem",
        monitorFindingHtml({
          title: "TLS Certificate Problem",
          check: `origin TLS certificate (${PUBLIC_HOSTNAME})`,
          detail: `${reason}. Replace ssl/cert.pem and ssl/key.pem on the host and recreate nginx: an invalid origin certificate makes Cloudflare fail every request.`,
          timestamp: new Date().toISOString(),
        })
      );
    }
  } else if (alerted.cert) {
    alerted.cert = false;
    log("[CHECK] certificate problem cleared");
  }
}

// Incremental access-log reader state. Only bytes appended since the last read
// are parsed; the 5xx timestamps seen are kept for the sliding window.
const logCursor: { ino: number | null; offset: number; partial: string } = {
  ino: null,
  offset: 0,
  partial: "",
};
let authErrorTimes: number[] = [];
const probeWindow = new ProbeWindow(PROBE_WINDOW_MS);
const scannerTally = new ScannerTally();
// Offenders waiting for the next probe email, and API-probing IPs emailed
// since the last routine report.
const pendingProbes = new Map<string, ProbeOffender>();
let lastProbeAlertAt = 0;
let probeIpsSinceReport = 0;

function readNewLogLines(stat: fs.Stats): string[] {
  if (logCursor.ino === null) {
    // First read: look back a bounded amount to seed the window.
    logCursor.offset = Math.max(0, stat.size - LOG_INITIAL_TAIL_BYTES);
    logCursor.partial = "";
  } else if (stat.ino !== logCursor.ino || stat.size < logCursor.offset) {
    // Rotated (new inode) or truncated (the nginx service truncates on start):
    // everything in the file is new.
    logCursor.offset = 0;
    logCursor.partial = "";
  }
  logCursor.ino = stat.ino;

  let from = logCursor.offset;
  if (stat.size - from > LOG_MAX_READ_BYTES) {
    from = stat.size - LOG_MAX_READ_BYTES;
    logCursor.partial = "";
  }
  const length = stat.size - from;
  if (length <= 0) return [];

  const buf = Buffer.alloc(length);
  const fd = fs.openSync(NGINX_LOG, "r");
  let read = 0;
  try {
    read = fs.readSync(fd, buf, 0, length, from);
  } finally {
    fs.closeSync(fd);
  }
  logCursor.offset = from + read;

  const text = logCursor.partial + buf.subarray(0, read).toString("utf8");
  const lines = text.split("\n");
  // The last element is an incomplete line still being written (or "").
  logCursor.partial = lines.pop() ?? "";
  return lines;
}

async function checkNginxAuthErrors() {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(NGINX_LOG);
  } catch {
    log(`[CHECK] nginx log not found at ${NGINX_LOG}, skipping`);
    return;
  }
  if (!stat.isFile()) {
    log(`[CHECK] nginx log is not a regular file (symlink/device), skipping`);
    return;
  }
  const scannerHits: string[] = [];
  try {
    for (const line of readNewLogLines(stat)) {
      const entry = parseAccessLine(line);
      if (!entry) continue;
      probeWindow.add(entry);
      scannerTally.add(entry);
      if (isScannerHit(entry) && !alerted.scannerHitPaths.has(entry.path)) {
        alerted.scannerHitPaths.add(entry.path);
        scannerHits.push(`${entry.path} answered ${entry.status} to ${entry.ip}`);
      }
      if (entry.path.startsWith("/api/auth") && entry.status >= 500) authErrorTimes.push(entry.ts);
    }
  } catch (err) {
    log(`[CHECK] nginx log parse error: ${err}`);
    return;
  }

  const windowStart = Date.now() - AUTH_ERROR_WINDOW_MS;
  authErrorTimes = authErrorTimes.filter((ts) => ts >= windowStart);
  const count = authErrorTimes.length;
  log(`[CHECK] nginx auth 5xx in last 5min: ${count}`);

  if (count > AUTH_ERROR_THRESHOLD) {
    if (!alerted.authErrors) {
      alerted.authErrors = true;
      await sendAlert(
        "⚠️ Crypteo Nginx Auth Errors",
        authErrorsHtml({ count, timestamp: new Date().toISOString() })
      );
    }
  } else if (alerted.authErrors) {
    alerted.authErrors = false;
    log("[CHECK] nginx auth errors back under threshold");
  }

  if (scannerHits.length > 0) {
    await sendAlert(
      "⛔ Crypteo Scanner Path Served",
      monitorFindingHtml({
        title: "Scanner Path Served",
        check: "Nginx access log",
        detail: `A path only scanners ask for was answered with content, so a secret or config file may have been read: ${scannerHits.slice(0, 10).join("; ")}. Check what the path serves and rotate anything it exposed.`,
        timestamp: new Date().toISOString(),
      })
    );
  }

  const now = Date.now();
  const offenders = probeWindow.offenders(now, PROBE_THRESHOLD);
  for (const o of offenders) {
    if (!alerted.probeIps.has(o.ip) || pendingProbes.has(o.ip)) pendingProbes.set(o.ip, o);
  }
  alerted.probeIps = new Set(offenders.map((o) => o.ip));
  if (pendingProbes.size > 0 && now - lastProbeAlertAt >= PROBE_ALERT_EVERY_MS) {
    const batch = [...pendingProbes.values()];
    pendingProbes.clear();
    lastProbeAlertAt = now;
    probeIpsSinceReport += batch.length;
    log(`[CHECK] API probing from ${batch.map((o) => o.ip).join(", ")}`);
    await sendAlert(
      "🛡️ Crypteo API Probing",
      probeTrafficHtml({
        offenders: batch,
        windowMinutes: PROBE_WINDOW_MS / 60_000,
        threshold: PROBE_THRESHOLD,
        timestamp: new Date(now).toISOString(),
      })
    );
  }
}

async function sendRoutineReport() {
  if (adminRecipients().length === 0) return;
  const calc = (s: CheckState) =>
    s.totalChecks
      ? (((s.totalChecks - s.totalFailures) / s.totalChecks) * 100).toFixed(2)
      : "N/A";

  log("[REPORT] Sending routine report");
  const scanners = scannerTally.take();
  const probeIps = probeIpsSinceReport;
  probeIpsSinceReport = 0;
  await sendAdminAlert(
    "📊 Crypteo Monitor Report",
    routineReportHtml({
      chains: lastChains
        ? {
            healthy: lastChains.healthy ?? null,
            checkedAt: lastChains.checkedAt ?? null,
            degraded: lastChains.degraded ?? [],
          }
        : undefined,
      timestamp: new Date().toISOString(),
      nextReportHours: REPORT_INTERVAL_MS / 3_600_000,
      probes: { scannerRequests: scanners.requests, scannerIps: scanners.ips, apiProbeIps: probeIps },
      app: {
        status: state.app.alertedDown ? "DOWN" : "UP",
        uptime: calc(state.app),
        lastResponseTime: state.app.lastResponseTime,
        totalChecks: state.app.totalChecks,
        totalFailures: state.app.totalFailures,
      },
      nginx: {
        status: state.nginx.alertedDown ? "DOWN" : "UP",
        uptime: calc(state.nginx),
        lastResponseTime: state.nginx.lastResponseTime,
        totalChecks: state.nginx.totalChecks,
        totalFailures: state.nginx.totalFailures,
      },
    }),
  ).catch(console.error);
}

async function runChecks() {
  const currentDay = new Date().getUTCDate();
  if (currentDay !== lastResetDay) {
    log("[CYCLE] New day detected, resetting monitor counters.");
    state.app.totalChecks = 0;
    state.app.totalFailures = 0;
    state.nginx.totalChecks = 0;
    state.nginx.totalFailures = 0;
    lastResetDay = currentDay;
  }

  log("[CYCLE] Running checks...");
  await Promise.all([
    runCheck("App Server", checkApp),
    runCheck("Nginx Proxy", checkNginx),
    runCheck("Nginx Auth Errors", checkNginxAuthErrors),
    runCheck("TLS Certificate", checkCertificate),
    runCheck("Database Backup", checkBackups),
  ]);
  log("[CYCLE] Done.");
}

/**
 * Run one check, alerting if the check itself throws.
 *
 * A check that crashes is a monitoring blind spot: previously these were
 * swallowed by allSettled and the cycle reported "Done", so a permanently
 * broken check looked exactly like a passing one. Latched per check so a
 * persistent fault alerts once and re-arms on recovery.
 */
async function runCheck(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    if (alerted.checks.has(name)) {
      alerted.checks.delete(name);
      log(`[CHECK] ${name} check recovered`);
    }
  } catch (err) {
    log(`[CHECK] ${name} check THREW: ${err}`);
    if (alerted.checks.has(name)) return;
    alerted.checks.add(name);
    await sendAlert(
      `🧪 Crypteo Monitor Check Failed: ${name}`,
      checkFailureHtml({
        check: name,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      })
    ).catch((e) => log(`[ALERT] failed to report check failure: ${e}`));
  }
}

async function sendStackStartupReport() {
  const timestamp = new Date().toISOString();
  const services: ServiceStartupStatus[] = [];
  let workerStatus: ServiceStartupStatus["status"] = "unreachable";

  // Probe app
  try {
    const { status, elapsed, body } = await httpGet(APP_URL);
    const isUp = status === 200;
    services.push({
      name: "App Server",
      status: isUp ? "online" : "unreachable",
      responseTime: elapsed,
    });

    // Infer DB and worker from health body
    try {
      const json = JSON.parse(body) as HealthBody & { status?: string };
      services.push({
        name: "PostgreSQL",
        status:
          json.status === "ok" || json.status === "degraded"
            ? "online"
            : "unreachable",
      });
      // Reported from the worker's own heartbeat rather than assumed — the
      // whole point is that a worker can be "up" as a process and not polling.
      workerStatus = json.worker?.healthy ? "online" : "unreachable";
    } catch {
      services.push({
        name: "PostgreSQL",
        status: isUp ? "online" : "unreachable",
      });
    }
  } catch {
    services.push({ name: "App Server", status: "unreachable" });
    services.push({ name: "PostgreSQL", status: "unreachable" });
  }

  // Probe nginx
  try {
    const { elapsed } = await probeNginx();
    services.push({
      name: "Nginx Proxy",
      status: "online",
      responseTime: elapsed,
    });
  } catch {
    services.push({ name: "Nginx Proxy", status: "unreachable" });
  }

  services.push({ name: "Payment Worker", status: workerStatus });
  services.push({ name: "Monitor", status: "online" });

  await sendAlert(
    "🟢 Crypteo Stack Online",
    stackStartupHtml({ timestamp, services })
  );
}

// The monitor is the last line of defence, so its own death must be loud.
// Without these a crash here is completely silent: alerting simply stops and
// the stack looks fine because nothing is left to say otherwise.
process.on("uncaughtException", (err) => {
  log(`[FATAL] uncaughtException: ${err.stack || err}`);
  sendAlert(
    "🔴 Crypteo Monitor Crashed",
    checkFailureHtml({
      check: "Monitor process",
      error: err.message,
      timestamp: new Date().toISOString(),
    })
  ).finally(() => setTimeout(() => process.exit(1), 3000));
});

process.on("unhandledRejection", (reason) => {
  log(`[FATAL] unhandledRejection: ${reason}`);
  sendAlert(
    "🔴 Crypteo Monitor Crashed",
    checkFailureHtml({
      check: "Monitor process",
      error: String(reason),
      timestamp: new Date().toISOString(),
    })
  ).finally(() => setTimeout(() => process.exit(1), 3000));
});

async function main() {
  log("Monitor started, waiting 10s for services to stabilize...");
  await new Promise((r) => setTimeout(r, 10_000));
  await sendStackStartupReport();
  runChecks();
  setInterval(runChecks, POLL_INTERVAL_MS);
  setInterval(sendRoutineReport, REPORT_INTERVAL_MS);
}

main();
