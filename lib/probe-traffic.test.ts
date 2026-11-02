import { describe, expect, it } from "vitest";
import {
  isApiProbe,
  isProbeRequest,
  isScannerHit,
  isScannerRequest,
  parseAccessLine,
  ProbeWindow,
  ScannerTally,
  type AccessEntry,
} from "./probe-traffic";

const LINE =
  '45.61.164.239 - - [23/Oct/2026:17:13:54 +0000] "POST /api/auth/verify/resend HTTP/1.1" 404 58 "-" "Mozilla/5.0"';

const entry = (over: Partial<AccessEntry> = {}): AccessEntry => ({
  ip: "203.0.113.9",
  ts: Date.UTC(2026, 9, 23, 17, 0, 0),
  method: "POST",
  path: "/api/auth/verify/resend",
  status: 404,
  ...over,
});

describe("parseAccessLine", () => {
  it("reads nginx's combined format", () => {
    expect(parseAccessLine(LINE)).toEqual({
      ip: "45.61.164.239",
      ts: Date.UTC(2026, 9, 23, 17, 13, 54),
      method: "POST",
      path: "/api/auth/verify/resend",
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
