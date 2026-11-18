import { describe, expect, it } from "vitest";
import {
  isApiProbe,
  isProbeRequest,
  isScannerHit,
  isScannerRequest,
  parseAccessLine,
  injectionKind,
  InjectionTally,
  ProbeWindow,
  ScannerTally,
  type AccessEntry,
} from "./probe-traffic";

const LINE =
  '203.0.113.239 - - [23/Oct/2026:17:13:54 +0000] "POST /api/auth/verify/resend HTTP/1.1" 404 58 "-" "Mozilla/5.0"';

const entry = (over: Partial<AccessEntry> = {}): AccessEntry => ({
  ip: "203.0.113.9",
  ts: Date.UTC(2026, 9, 23, 17, 0, 0),
  method: "POST",
  path: "/api/auth/verify/resend",
  target: over.path ?? "/api/auth/verify/resend",
  status: 404,
  ...over,
});

describe("parseAccessLine", () => {
  it("reads nginx's combined format", () => {
    expect(parseAccessLine(LINE)).toEqual({
      ip: "203.0.113.239",
      ts: Date.UTC(2026, 9, 23, 17, 13, 54),
      method: "POST",
      path: "/api/auth/verify/resend",
      target: "/api/auth/verify/resend",
      status: 404,
    });
  });

  it("drops the query string and honours the zone offset", () => {
    const e = parseAccessLine(
      '::1 - - [23/Oct/2026:19:14:56 +0200] "GET /api/auth/verify?email=a@b.c&otp=0 HTTP/1.1" 405 5 "-" "x"',
    );
    expect(e).toMatchObject({ ip: "::1", path: "/api/auth/verify", ts: Date.UTC(2026, 9, 23, 17, 14, 56) });
  });

  it("returns null for anything else", () => {
    expect(parseAccessLine("")).toBeNull();
    expect(parseAccessLine("garbage line")).toBeNull();
  });
});

describe("isProbeRequest", () => {
  it("counts API client errors and scanner paths", () => {
    expect(isProbeRequest(entry())).toBe(true);
    expect(isProbeRequest(entry({ path: "/api/admin/merchants", status: 401, method: "GET" }))).toBe(true);
    expect(isProbeRequest(entry({ path: "/.env", status: 307, method: "GET" }))).toBe(true);
    expect(isProbeRequest(entry({ path: "/wp-login.php", status: 404, method: "GET" }))).toBe(true);
  });

  it("ignores successes, server errors, rate-limit answers, preflights and pages", () => {
    expect(isProbeRequest(entry({ status: 200 }))).toBe(false);
    expect(isProbeRequest(entry({ status: 500 }))).toBe(false);
    expect(isProbeRequest(entry({ status: 429 }))).toBe(false);
    expect(isProbeRequest(entry({ method: "OPTIONS", status: 404 }))).toBe(false);
    expect(isProbeRequest(entry({ path: "/login", status: 404, method: "GET" }))).toBe(false);
  });
});

describe("ProbeWindow", () => {
  const now = Date.UTC(2026, 9, 23, 17, 10, 0);

  it("reports an IP over the threshold with its busiest paths", () => {
    const w = new ProbeWindow(10 * 60_000);
    for (let i = 0; i < 30; i++) w.add(entry({ ts: now - i * 1000 }));
    for (let i = 0; i < 15; i++) w.add(entry({ ts: now - i * 1000, path: "/api/admin/stats", status: 404 }));
    for (let i = 0; i < 5; i++) w.add(entry({ ip: "198.51.100.1", ts: now }));
    expect(w.offenders(now, 40)).toEqual([
      { ip: "203.0.113.9", count: 45, topPaths: ["/api/auth/verify/resend (30)", "/api/admin/stats (15)"] },
    ]);
  });

  it("forgets requests older than the window", () => {
    const w = new ProbeWindow(10 * 60_000);
    for (let i = 0; i < 50; i++) w.add(entry({ ts: now - 11 * 60_000 }));
    expect(w.offenders(now, 40)).toEqual([]);
  });

  it("leaves scanner sweeps out: fail2ban handles them and they only buried the alert", () => {
    const w = new ProbeWindow(10 * 60_000);
    for (let i = 0; i < 100; i++) w.add(entry({ ts: now, method: "GET", path: "/.env", status: 307 }));
    expect(w.offenders(now, 40)).toEqual([]);
  });

  it("does not count ordinary traffic", () => {
    const w = new ProbeWindow(10 * 60_000);
    for (let i = 0; i < 100; i++) w.add(entry({ ts: now, status: 200 }));
    expect(w.offenders(now, 40)).toEqual([]);
  });
});

describe("scanner requests", () => {
  const scan = (over: Partial<AccessEntry> = {}) => entry({ method: "GET", path: "/.env", status: 307, ...over });

  it("splits the probe rule into scanner sweeps and API probing", () => {
    expect(isScannerRequest(scan())).toBe(true);
    expect(isApiProbe(scan())).toBe(false);
    expect(isApiProbe(entry())).toBe(true);
    expect(isScannerRequest(entry())).toBe(false);
    expect(isProbeRequest(scan()) && isProbeRequest(entry())).toBe(true);
  });

  it("flags only a scanner path answered with content", () => {
    expect(isScannerHit(scan({ status: 200 }))).toBe(true);
    for (const status of [307, 404, 403, 500]) expect(isScannerHit(scan({ status }))).toBe(false);
    expect(isScannerHit(entry({ method: "GET", path: "/login", status: 200 }))).toBe(false);
  });

  it("tallies sweeps for the routine report and starts over once taken", () => {
    const t = new ScannerTally();
    t.add(scan());
    t.add(scan({ path: "/.aws/credentials" }));
    t.add(scan({ ip: "198.51.100.7" }));
    t.add(entry());
    expect(t.take()).toEqual({ requests: 3, ips: 2 });
    expect(t.take()).toEqual({ requests: 0, ips: 0 });
  });
});

// Lines as the 2026-11-15 prober sent them, one IP per request.
const line = (ip: string, request: string, status = 401) =>
  `${ip} - - [15/Nov/2026:12:52:54 +0000] "${request} HTTP/1.1" ${status} 35 "https://crypteo.io/dashboard" "Mozilla/5.0"`;

describe("injectionKind", () => {
  it("names the payload in an API URL, decoded", () => {
    const cases: [string, string][] = [
      ["GET /api/payments?search=%27%3B%20SELECT%20pg_sleep%286%29--", "SQL injection"],
      ["GET /api/payments?search=1%3B%20WAITFOR%20DELAY%20%270%3A0%3A6%27--", "SQL injection"],
      ["GET /api/payments/c%27%2BSLEEP%283%29%2B%27", "SQL injection"],
      ["GET /api/payments/cmpay0000000000000000test%20AND%201%3D1", "SQL injection"],
      ["GET /api/payments?search=1%20OR%201=1", "SQL injection"],
      ["GET /api/payments/x%2527%20OR%20%25271%2527%3D%25271", "SQL injection"],
    ];
    for (const [request, kind] of cases) {
      const e = parseAccessLine(line("203.0.113.242", request));
      expect(e && injectionKind(e), request).toBe(kind);
    }
  });

  it("ignores ordinary API traffic, bare quote fuzzing and payloads aimed at the site root", () => {
    for (const request of [
      "GET /api/payments?page=1&limit=50",
      "GET /api/payments/cmpay0000000000000000test%27",
      "GET /?q=UNION+SELECT+ALL+FROM+information_schema+AND+%22+or+SLEEP(5)+or+%22",
      "GET /api/payments?search=O%27Brien%27s%20shop",
    ]) {
      const e = parseAccessLine(line("203.0.113.9", request, 200));
      expect(e && injectionKind(e), request).toBeNull();
    }
  });
});

describe("InjectionTally", () => {
  it("counts every hit across rotating IPs and keeps a bounded sample", () => {
    const tally = new InjectionTally(2);
    for (const ip of ["203.0.113.242", "203.0.113.127", "203.0.113.231"]) {
      const e = parseAccessLine(line(ip, "GET /api/payments?search=%22%20OR%20SLEEP(6)--"));
      if (e) tally.add(e);
    }
    expect(tally.pending).toBe(true);
    const taken = tally.take();
    expect(taken).toMatchObject({ requests: 3, ips: 3 });
    expect(taken.sample).toHaveLength(2);
    expect(taken.sample[0]?.request).toContain('" OR SLEEP(6)--');
    expect(tally.pending).toBe(false);
  });
});
