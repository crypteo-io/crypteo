import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  isBlockedWebhookIp,
  isBotUserAgent,
  isPrivateIp,
  isSafeWebhookUrl,
  postWebhook,
} from "./security";

describe("isSafeWebhookUrl", () => {
  it("rejects non-http(s) protocols", async () => {
    expect(await isSafeWebhookUrl("ftp://example.com")).toBe(false);
    expect(await isSafeWebhookUrl("file:///etc/passwd")).toBe(false);
    expect(await isSafeWebhookUrl("not a url")).toBe(false);
  });

  it("rejects localhost and internal-suffixed hosts", async () => {
    expect(await isSafeWebhookUrl("http://localhost/hook")).toBe(false);
    expect(await isSafeWebhookUrl("http://api.internal/hook")).toBe(false);
    expect(await isSafeWebhookUrl("http://db.local/hook")).toBe(false);
  });

  it("rejects private / loopback / link-local IP literals", async () => {
    expect(await isSafeWebhookUrl("http://127.0.0.1/hook")).toBe(false);
    expect(await isSafeWebhookUrl("http://10.1.2.3/hook")).toBe(false);
    expect(await isSafeWebhookUrl("http://192.168.0.5/hook")).toBe(false);
    expect(await isSafeWebhookUrl("http://172.16.9.9/hook")).toBe(false);
    // Cloud metadata endpoint — the classic SSRF target.
    expect(await isSafeWebhookUrl("http://169.254.169.254/latest/meta-data")).toBe(
      false,
    );
    expect(await isSafeWebhookUrl("http://[::1]/hook")).toBe(false);
  });

  it("allows a public IP literal", async () => {
    expect(await isSafeWebhookUrl("https://8.8.8.8/hook")).toBe(true);
  });
});

describe("isPrivateIp", () => {
  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "192.0.0.8", // IETF protocol assignments
    "192.0.2.1", // TEST-NET-1
    "198.18.0.1", // benchmarking 198.18/15
    "198.19.255.254",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1", // multicast
    "239.255.255.250",
    "240.0.0.1", // reserved
    "255.255.255.255",
  ])("blocks reserved IPv4 %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    "::",
    "::1",
    "::127.0.0.1", // IPv4-compatible
    "::a9fe:a9fe", // IPv4-compatible, hex form of 169.254.169.254
    "::ffff:127.0.0.1", // IPv4-mapped
    "::ffff:7f00:1", // IPv4-mapped as the URL parser serialises it
    "::ffff:a9fe:a9fe",
    "64:ff9b::a9fe:a9fe", // NAT64 → metadata endpoint
    "64:ff9b::10.0.0.1",
    "64:ff9b:1::1", // local-use NAT64
    "2002:7f00:1::", // 6to4 → 127.0.0.1
    "2002:c0a8:0101::1", // 6to4 → 192.168.1.1
    "2001:0:4136:e378::1", // Teredo
    "2001:db8::1", // documentation
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::1",
    "fe80::1%eth0",
    "ff02::1", // multicast
    "fec0::1", // site-local
  ])("blocks private/embedded IPv6 %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "198.20.0.1",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808", // NAT64 → 8.8.8.8
    "2002:808:808::1", // 6to4 → 8.8.8.8
  ])("allows public address %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe("isSafeWebhookUrl IPv6 literals", () => {
  it("rejects bracketed private IPv6 literals the URL parser rewrites", async () => {
    expect(await isSafeWebhookUrl("http://[::ffff:127.0.0.1]/hook")).toBe(false);
    expect(await isSafeWebhookUrl("http://[::ffff:169.254.169.254]/")).toBe(false);
    expect(await isSafeWebhookUrl("http://[64:ff9b::169.254.169.254]/")).toBe(false);
    expect(await isSafeWebhookUrl("http://[fe80::1]/hook")).toBe(false);
  });

  it("allows a bracketed public IPv6 literal", async () => {
    expect(await isSafeWebhookUrl("https://[2606:4700:4700::1111]/hook")).toBe(
      true,
    );
  });
});

describe("isBotUserAgent", () => {
  it("flags crawlers and link unfurlers", () => {
    expect(isBotUserAgent("Twitterbot/1.0")).toBe(true);
    expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true);
    expect(isBotUserAgent("TelegramBot (like TwitterBot)")).toBe(true);
    expect(isBotUserAgent("curl/8.1.2")).toBe(true);
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
  });

  it("passes a normal browser UA", () => {
    expect(
      isBotUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      ),
    ).toBe(false);
  });
});

describe("postWebhook (connect-time SSRF guard)", () => {
  // A real server on loopback: every test asserts it is never reached.
  let server: import("http").Server;
  let port = 0;
  let hits = 0;

  beforeAll(async () => {
    const http = await import("http");
    server = http.createServer((_req, res) => {
      hits++;
      res.end("internal secret");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as import("net").AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    hits = 0;
  });
  afterEach(() => {
    delete process.env.WEBHOOK_BLOCKED_IPS;
  });

  const post = (url: string) =>
    postWebhook(url, { headers: {}, body: "{}", timeoutMs: 2000 });

  it("refuses a literal loopback address without connecting", async () => {
    await expect(post(`http://127.0.0.1:${port}/`)).rejects.toThrow(/blocked/);
    expect(hits).toBe(0);
  });

  it("refuses a hostname that resolves to an internal address at connect time", async () => {
    // "localhost" stands in for a rebinding domain: whatever an earlier
    // validation saw, the address used for the socket is re-checked.
    await expect(post(`http://localhost:${port}/`)).rejects.toMatchObject({
      code: "EWEBHOOKBLOCKED",
    });
    expect(hits).toBe(0);
  });

  it("refuses the host's own configured public IPs", async () => {
    process.env.WEBHOOK_BLOCKED_IPS = "203.0.113.10, 2001:db8::1";
    await expect(post("http://203.0.113.10:22/")).rejects.toThrow(/blocked/);
    await expect(post("http://[2001:db8::1]/")).rejects.toThrow(/blocked/);
    expect(isBlockedWebhookIp("203.0.113.10")).toBe(true);
    expect(await isSafeWebhookUrl("http://203.0.113.10:3000/")).toBe(false);
  });

  it("refuses non-http(s) schemes", async () => {
    await expect(post("file:///etc/passwd")).rejects.toThrow(/http/);
  });
});
