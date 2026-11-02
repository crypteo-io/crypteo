import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { isProbeRequest, parseAccessLine } from "./probe-traffic";

// The host's fail2ban filters (fail2ban/filter.d) ban what the monitor
// reports (lib/probe-traffic.ts). They are twins in two languages: this
// fails when they disagree on a log line.

function failregex(filter: string): RegExp {
  const conf = readFileSync(join(__dirname, "..", "fail2ban", "filter.d", `${filter}.conf`), "utf8");
  const line = conf.split("\n").find((l) => l.startsWith("failregex = "));
  if (!line) throw new Error(`${filter}: no failregex`);
  return new RegExp(line.slice("failregex = ".length).replace("<HOST>", "(\\S+)"));
}

const FILTERS = [failregex("nginx-scanner"), failregex("nginx-api-probe")];

// fail2ban removes the matched timestamp before applying failregex.
const banned = (line: string) => {
  const dateless = line.replace(/\[[^\]]+\]/, "[]");
  return FILTERS.some((re) => re.test(dateless));
};

const at = (ip: string, request: string, status: number) =>
  `${ip} - - [23/Oct/2026:17:13:54 +0000] "${request} HTTP/1.1" ${status} 58 "-" "Mozilla/5.0"`;

const LINES = [
  at("45.61.164.239", "POST /api/auth/verify/resend", 404),
  at("45.61.164.239", "POST /api/auth/reset-password", 400),
  at("45.61.164.239", "GET /api/admin/merchants", 401),
  at("45.61.164.239", "PROPFIND /api/payments", 405),
  at("45.61.164.239", "POST /api/auth/forgot-password", 200),
  at("45.61.164.239", "POST /api/auth/reset-password", 500),
  at("45.61.164.239", "OPTIONS /api/admin/stats", 404),
  at("102.88.111.132", "GET /api/payments/cmv2let0k0088iuglbuwggt6o", 429),
  at("102.88.111.132", "POST /api/public/v1/payments", 429),
  at("2605:59c0::1", "GET /api/auth/session", 200),
  at("35.243.118.204", "GET /.env", 307),
  at("35.243.118.204", "GET /.env.production?raw=", 307),
  at("35.243.118.204", "GET /dashboard/.env", 307),
  at("34.156.249.47", "GET /.aws/credentials", 404),
  at("34.156.249.47", "GET /.git/config", 404),
  at("34.156.249.47", "GET /wp-login.php", 404),
  at("34.156.249.47", "GET /phpmyadmin/index", 404),
  at("35.243.118.204", "GET /login?callbackUrl=%2F.env%3Fraw%3D", 200),
  at("35.243.118.204", "GET /login?next=/.env", 200),
  at("35.243.118.204", "GET /docs", 200),
  at("102.88.111.132", "GET /dashboard/settings", 200),
  at("102.88.111.132", "GET /login", 404),
];

describe("fail2ban filters", () => {
  it.each(LINES)("ban exactly what the monitor counts as a probe: %s", (line) => {
    const entry = parseAccessLine(line);
    if (!entry) throw new Error("unparsed fixture");
    expect(banned(line)).toBe(isProbeRequest(entry));
  });

  it("cover both kinds of probe in the fixtures", () => {
    expect(LINES.filter(banned).length).toBeGreaterThan(5);
    expect(LINES.filter((l) => !banned(l)).length).toBeGreaterThan(5);
  });
});
