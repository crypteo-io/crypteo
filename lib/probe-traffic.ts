// Probe traffic in the nginx access log (scripts/monitor.ts). On 2026-10-23
// one IP sent ~3,000 requests in two hours: guessed admin routes, fuzzed every
// auth endpoint and enumerated accounts. Only its 30 malformed reset-password
// bodies (then 500s) raised an alert; the client errors it caused raised
// nothing, and once malformed bodies were answered 400 nothing would have.
//
// Only API probing emails. Scanner sweeps for /.env emailed dozens of times a
// day from both sites (2026-10-24) and buried the alert; fail2ban challenges
// them, the routine report counts them, and only a scanner path answered
// with content (isScannerHit) emails.

export interface AccessEntry {
  ip: string;
  ts: number;
  method: string;
  path: string;
  status: number;
}

const LINE = /^(\S+) \S+ \S+ \[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{4})\] "(\S+) (\S+)[^"]*" (\d{3}) /;

/** One line of nginx's default "combined" format, or null if it isn't one. */
export function parseAccessLine(line: string): AccessEntry | null {
  const m = LINE.exec(line);
  if (!m) return null;
  const [, ip, day, month, year, time, zone, method, path, status] = m;
  const ts = new Date(`${month} ${day} ${year} ${time} ${zone}`).getTime();
  if (!Number.isFinite(ts)) return null;
  return { ip, ts, method, path: path.split("?")[0], status: Number(status) };
}

// Paths only a scanner asks for: this is a Next.js app with no PHP, no
// WordPress and no dotfiles served.
const SCANNER_PATH = /(^|\/)\.(env|git|aws|ssh|DS_Store)|\.php\b|\/wp-(admin|login|content|includes)|\/(phpmyadmin|cgi-bin|actuator|server-status)\b/i;

/** A request for a file only a scanner asks for. */
export function isScannerRequest(e: AccessEntry): boolean {
  return SCANNER_PATH.test(e.path);
}

/**
 * An API call answered with a client error: a real dashboard or integration
 * makes few. Preflights are left out: the browser sends them, not the
 * caller's code. So is 429: the limiter already answered it, and buyers
 * polling checkout behind one carrier NAT, or a busy merchant integration,
 * reach it legitimately.
 */
export function isApiProbe(e: AccessEntry): boolean {
  return (
    e.method !== "OPTIONS" && e.path.startsWith("/api/") && e.status >= 400 && e.status < 500 && e.status !== 429
  );
}

/** What the host's fail2ban bans (fail2ban/filter.d, lib/fail2ban-parity.test.ts). */
export function isProbeRequest(e: AccessEntry): boolean {
  return isScannerRequest(e) || isApiProbe(e);
}

/**
 * A scanner path the site answered with content. Sweeps for /.env reach
 * every public server many times a day and are only counted; one that got a
 * 2xx may have read a secret.
 */
export function isScannerHit(e: AccessEntry): boolean {
  return isScannerRequest(e) && e.status >= 200 && e.status < 300;
}

export interface ProbeOffender {
  ip: string;
  count: number;
  /** The paths it probed most, busiest first. */
  topPaths: string[];
}

/** API probe requests per IP over a sliding window. */
export class ProbeWindow {
  private entries: AccessEntry[] = [];

  constructor(private readonly windowMs: number) {}

  add(e: AccessEntry): void {
    if (isApiProbe(e)) this.entries.push(e);
  }

  /** IPs with more than `threshold` API probe requests in the window ending at `now`. */
  offenders(now: number, threshold: number): ProbeOffender[] {
    this.entries = this.entries.filter((e) => e.ts >= now - this.windowMs);
    const byIp = new Map<string, Map<string, number>>();
    for (const e of this.entries) {
      const paths = byIp.get(e.ip) ?? new Map<string, number>();
      paths.set(e.path, (paths.get(e.path) ?? 0) + 1);
      byIp.set(e.ip, paths);
    }
    return [...byIp]
      .map(([ip, paths]) => ({
        ip,
        count: [...paths.values()].reduce((a, b) => a + b, 0),
        topPaths: [...paths].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, n]) => `${p} (${n})`),
      }))
      .filter((o) => o.count > threshold)
      .sort((a, b) => b.count - a.count);
  }
}

/** Scanner sweeps since the last routine report, for its one-line count. */
export class ScannerTally {
  private requests = 0;
  private readonly ips = new Set<string>();

  add(e: AccessEntry): void {
    if (!isScannerRequest(e)) return;
    this.requests++;
    this.ips.add(e.ip);
  }

  /** The counts so far, and a fresh start. */
  take(): { requests: number; ips: number } {
    const counts = { requests: this.requests, ips: this.ips.size };
    this.requests = 0;
    this.ips.clear();
    return counts;
  }
}
