import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// nginx lists Cloudflare's ranges twice: whose CF-Connecting-IP it believes,
// and who may connect to the public 8443 at all (anyone else is closed, so the
// origin can't be reached around Cloudflare). A range missing from the second
// cuts off real visitors.
const nginx = readFileSync("nginx/nginx.conf", "utf8");
const LOCAL = ["127.0.0.1/32", "::1/128", "172.16.0.0/12"];

const sorted = (list: string[]) => [...list].sort();
const realIp = sorted([...nginx.matchAll(/set_real_ip_from\s+([^;]+);/g)].map((m) => (m[1] ?? "").trim()));
const geoBlock = /geo \$realip_remote_addr \$via_cloudflare \{([^}]*)\}/.exec(nginx)?.[1] ?? "";
const allowed = sorted(
  [...geoBlock.matchAll(/^\s*([0-9a-f:./]+)\s+1;/gm)].map((m) => m[1] ?? "").filter((r) => !LOCAL.includes(r)),
);

describe("nginx Cloudflare ranges", () => {
  it("lists Cloudflare's ranges", () => {
    expect(realIp.length).toBeGreaterThanOrEqual(20);
    expect(realIp).toContain("173.245.48.0/20");
  });

  it("lets exactly Cloudflare (and this host) connect", () => {
    expect(allowed).toEqual(realIp);
    expect(geoBlock).toMatch(/default 0;/);
    expect(nginx).toMatch(/if \(\$via_cloudflare = 0\) \{ return 444; \}/);
  });
});
