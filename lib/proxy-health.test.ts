import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ outboundProxy: { findMany: vi.fn(), updateMany: vi.fn() } }));
vi.mock("./db", () => ({ prisma: db }));
vi.mock("./notifications", () => ({ notifyAdmins: vi.fn() }));
vi.mock("./admin-alerts", () => ({ sendAdminAlert: vi.fn() }));
const request = vi.hoisted(() => vi.fn());
vi.mock("axios", () => ({ default: { request } }));

import { sendAdminAlert } from "./admin-alerts";
import { notifyAdmins } from "./notifications";
import {
  checkAllProxies,
  checkProxy,
  PROXY_ALERT_COOLDOWN_MS,
  PROXY_CHECK_TARGETS,
  scrubProxyError,
  shouldAlert,
  transition,
} from "./proxy-health";
import { encryptProxyUrl, PROXY_FAILING_AFTER } from "./proxy-settings";

const URL_WITH_CREDS = "http://us%40er:s3cr%40tpass@proxy.example:8080";
const NOW = new Date("2026-10-19T12:00:00Z");
const GOOD = { status: 200, data: { data: {}, result: "0x1" } };
const fail = { ok: false, latencyMs: null, error: "x" };
const pass = { ok: true, latencyMs: 5, error: null };

/** Direct requests (the control) answer `direct`; proxied ones `proxied`. */
function network(direct: unknown, proxied: unknown) {
  request.mockImplementation(async (config: { httpsAgent?: unknown }) => {
    const answer = config.httpsAgent ? proxied : direct;
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: "cproxy0000000000000000001",
    url: encryptProxyUrl(URL_WITH_CREDS),
    label: "EU",
    isActive: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastCheckedAt: new Date(0),
    lastOkAt: null,
    lastLatencyMs: null,
    lastError: null,
    consecutiveFailures: 0,
    alertOpen: false,
    lastAlertAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.TWO_FACTOR_ENCRYPTION_KEY = "k".repeat(40);
  db.outboundProxy.updateMany.mockResolvedValue({ count: 1 });
  vi.mocked(sendAdminAlert).mockResolvedValue(true);
});

describe("scrubProxyError", () => {
  it("removes the URL and the credentials, encoded or not", () => {
    const msg = `connect failed via ${URL_WITH_CREDS} (us@er:s3cr@tpass) with s3cr@tpass and s3cr%40tpass`;
    const out = scrubProxyError(msg, URL_WITH_CREDS);
    for (const secret of ["s3cr@tpass", "s3cr%40tpass", "us@er:", URL_WITH_CREDS]) expect(out).not.toContain(secret);
  });

  it("doesn't garble the message for a short password", () => {
    expect(scrubProxyError("getaddrinfo ENOTFOUND one.example", "http://u:p@one.example:8080")).toBe("getaddrinfo ENOTFOUND one.example");
  });
});

describe("transition and shouldAlert", () => {
  it("tips into failing only at the threshold, and recovers only from failing", () => {
    expect(transition(PROXY_FAILING_AFTER - 2, fail)).toBeNull();
    expect(transition(PROXY_FAILING_AFTER - 1, fail)).toBe("failing");
    expect(transition(PROXY_FAILING_AFTER, fail)).toBeNull();
    expect(transition(PROXY_FAILING_AFTER, pass)).toBe("recovered");
    expect(transition(1, pass)).toBeNull();
  });

  it("opens a failing alert once per cooldown, and closes only one that was sent", () => {
    expect(shouldAlert("failing", { alertOpen: false, lastAlertAt: null }, NOW)).toBe(true);
    expect(shouldAlert("failing", { alertOpen: true, lastAlertAt: null }, NOW)).toBe(false);
    const recent = new Date(NOW.getTime() - PROXY_ALERT_COOLDOWN_MS + 60_000);
    const old = new Date(NOW.getTime() - PROXY_ALERT_COOLDOWN_MS);
    expect(shouldAlert("failing", { alertOpen: false, lastAlertAt: recent }, NOW)).toBe(false);
    expect(shouldAlert("failing", { alertOpen: false, lastAlertAt: old }, NOW)).toBe(true);
    expect(shouldAlert("recovered", { alertOpen: true, lastAlertAt: old }, NOW)).toBe(true);
    expect(shouldAlert("recovered", { alertOpen: false, lastAlertAt: old }, NOW)).toBe(false);
    expect(shouldAlert(null, { alertOpen: false, lastAlertAt: null }, NOW)).toBe(false);
  });
});

describe("checkProxy", () => {
  it("fails on a non-2xx or an answer without the expected field", async () => {
    network(GOOD, { status: 403, data: {} });
    expect(await checkProxy(URL_WITH_CREDS, PROXY_CHECK_TARGETS)).toMatchObject({ ok: false });
    network(GOOD, { status: 200, data: "<html>captive portal</html>" });
    expect(await checkProxy(URL_WITH_CREDS, PROXY_CHECK_TARGETS)).toMatchObject({ ok: false });
  });

  it("passes only when every target answers through it", async () => {
    network(GOOD, GOOD);
    expect(await checkProxy(URL_WITH_CREDS, PROXY_CHECK_TARGETS)).toMatchObject({ ok: true, error: null });
  });

  it("reports a connection error without the credentials", async () => {
    network(GOOD, new Error(`Proxy ${URL_WITH_CREDS} refused the connection`));
    const check = await checkProxy(URL_WITH_CREDS, PROXY_CHECK_TARGETS);
    expect(check.ok).toBe(false);
    expect(check.error).not.toContain("s3cr");
  });
});

describe("checkAllProxies", () => {
  it("records nothing when the test targets fail direct too (no false alarm)", async () => {
    db.outboundProxy.findMany.mockResolvedValue([row({ consecutiveFailures: PROXY_FAILING_AFTER - 1 })]);
    network(new Error("network down"), new Error("network down"));
    const scan = await checkAllProxies(() => NOW);
    expect(scan.inconclusive).toBe(true);
    expect(db.outboundProxy.updateMany).not.toHaveBeenCalled();
    expect(notifyAdmins).not.toHaveBeenCalled();
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it("alerts by email and in-app when a proxy reaches the threshold, without credentials", async () => {
    db.outboundProxy.findMany.mockResolvedValue([row({ consecutiveFailures: PROXY_FAILING_AFTER - 1 })]);
    network(GOOD, { status: 502, data: {} });
    const scan = await checkAllProxies(() => NOW);
    expect(scan.failing).toHaveLength(1);
    const write = db.outboundProxy.updateMany.mock.calls[0][0];
    expect(write.where).toMatchObject({ consecutiveFailures: PROXY_FAILING_AFTER - 1 });
    expect(write.data).toMatchObject({ consecutiveFailures: PROXY_FAILING_AFTER, alertOpen: true, lastAlertAt: NOW });
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyAdmins).mock.calls[0][0]).toMatchObject({ kind: "admin_proxy_failing", link: "/proxies" });
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
    const everything = JSON.stringify([vi.mocked(notifyAdmins).mock.calls, vi.mocked(sendAdminAlert).mock.calls]);
    expect(everything).not.toContain("s3cr");
  });

  it("announces nothing when another scan wrote first", async () => {
    db.outboundProxy.findMany.mockResolvedValue([row({ consecutiveFailures: PROXY_FAILING_AFTER - 1 })]);
    db.outboundProxy.updateMany.mockResolvedValue({ count: 0 });
    network(GOOD, { status: 502, data: {} });
    await checkAllProxies(() => NOW);
    expect(sendAdminAlert).not.toHaveBeenCalled();
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it("keeps a flapping proxy quiet inside the cooldown, but still records it", async () => {
    const lastAlertAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    db.outboundProxy.findMany.mockResolvedValue([row({ consecutiveFailures: PROXY_FAILING_AFTER - 1, lastAlertAt })]);
    network(GOOD, { status: 502, data: {} });
    await checkAllProxies(() => NOW);
    expect(db.outboundProxy.updateMany).toHaveBeenCalledTimes(1);
    expect(db.outboundProxy.updateMany.mock.calls[0][0].data).not.toHaveProperty("alertOpen");
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it("closes an open alert on recovery with one recovered email", async () => {
    db.outboundProxy.findMany.mockResolvedValue([row({ consecutiveFailures: PROXY_FAILING_AFTER + 4, alertOpen: true })]);
    network(GOOD, GOOD);
    const scan = await checkAllProxies(() => NOW);
    expect(scan.recovered).toHaveLength(1);
    expect(db.outboundProxy.updateMany.mock.calls[0][0].data).toMatchObject({ consecutiveFailures: 0, alertOpen: false });
    expect(vi.mocked(notifyAdmins).mock.calls[0][0]).toMatchObject({ kind: "admin_proxy_recovered" });
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
  });

  it("sends one email for every proxy that tipped in the same scan", async () => {
    db.outboundProxy.findMany.mockResolvedValue([
      row({ consecutiveFailures: PROXY_FAILING_AFTER - 1 }),
      row({ id: "cproxy0000000000000000002", label: "US", consecutiveFailures: PROXY_FAILING_AFTER - 1 }),
    ]);
    network(GOOD, { status: 502, data: {} });
    const scan = await checkAllProxies(() => NOW);
    expect(scan.failing).toHaveLength(2);
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendAdminAlert).mock.calls[0][0]).toContain("2 proxies are failing");
  });
});
