import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dogeAdapter, headersFor, zecAdapter } from "./blockbook";
import { resetEndpointPreferences } from "./rpc";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(axios.get);

const ADDR = "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L";
const BUYER = "DGUzATWpGdehtujWNyM464LB9Zx7Ch1Z67";

function serve(route: (url: string) => { status?: number; data: unknown } | undefined) {
  get.mockImplementation(async (url: string) => {
    const hit = route(url);
    if (!hit) throw new Error(`unrouted request: ${url}`);
    return { status: hit.status ?? 200, statusText: "", data: hit.data };
  });
}

const now = Math.floor(Date.now() / 1000);
const createdAt = new Date((now - 600) * 1000);

function tx(over: Partial<Record<string, unknown>> & { txid: string }) {
  return {
    confirmations: 7,
    blockTime: now - 60,
    vin: [{ addresses: [BUYER] }],
    vout: [{ addresses: [ADDR], value: "1000000000" }],
    ...over,
  };
}

beforeEach(() => {
  resetEndpointPreferences();
  get.mockReset();
  delete process.env.DOGE_API_URLS;
  delete process.env.ZEC_API_URLS;
  delete process.env.NOWNODES_API_KEY;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Blockbook snapshot", () => {
  it("reads the confirmed balance", async () => {
    serve(() => ({ data: { balance: "250000000", unconfirmedBalance: "999" } }));
    await expect(dogeAdapter.getBalanceSnapshot(ADDR)).resolves.toBe(2.5);
  });

  it("reads an unused address as zero", async () => {
    serve(() => ({ data: { balance: "0", txs: 0 } }));
    await expect(zecAdapter.getBalanceSnapshot("t1XQZdZMnzXBcL8yx2PR27dSNrqctgwLgux")).resolves.toBe(0);
  });

  it("handles totals past 2^53 base units without throwing", async () => {
    serve(() => ({ data: { balance: "5581286332085853042" } }));
    await expect(dogeAdapter.getBalanceSnapshot(ADDR)).resolves.toBeCloseTo(55812863320.85853, 0);
  });

  it("throws on an HTML challenge page instead of reading it as zero", async () => {
    serve(() => ({ data: "<!DOCTYPE html><html>challenge</html>" }));
    await expect(dogeAdapter.getBalanceSnapshot(ADDR)).rejects.toThrow(/unexpected response shape/);
  });

  it("throws on a non-numeric total", async () => {
    serve(() => ({ data: { balance: "-1" } }));
    await expect(dogeAdapter.getBalanceSnapshot(ADDR)).rejects.toThrow();
  });

  it("surfaces Blockbook's invalid-address error so it classifies as permanent", async () => {
    serve(() => ({ status: 400, data: { error: "Invalid address, decoded address is of unknown format" } }));
    await expect(dogeAdapter.getBalanceSnapshot(ADDR)).rejects.toThrow(/invalid address/i);
  });

  it("fails over between endpoints", async () => {
    serve((url) =>
      url.startsWith("https://blockbook.doge.zelcore.io")
        ? { status: 502, data: "" }
        : { data: { balance: "100000000" } },
    );
    await expect(dogeAdapter.getBalanceSnapshot(ADDR)).resolves.toBe(1);
  });
});

describe("Blockbook checkPayment", () => {
  const base = { address: ADDR, token: "doge", expectedAmount: 10, balanceSnapshot: 5, createdAt };

  it("reports nothing when the balance hasn't grown", async () => {
    serve(() => ({ data: { balance: "500000000", transactions: [] } }));
    await expect(dogeAdapter.checkPayment(base)).resolves.toEqual({ detected: false });
  });

  it("confirms a deposit with enough confirmations and names the buyer", async () => {
    serve(() => ({
      data: { balance: "1500000000", transactions: [tx({ txid: "pay" })] },
    }));
    await expect(dogeAdapter.checkPayment(base)).resolves.toMatchObject({
      detected: true,
      receivedAmount: 10,
      currentBalance: 15,
      txHash: "pay",
      fromAddress: BUYER,
      confirmations: 7,
      status: "confirmed",
    });
  });

  it("stays confirming below the requirement", async () => {
    serve(() => ({
      data: { balance: "1500000000", transactions: [tx({ txid: "pay", confirmations: 2 })] },
    }));
    await expect(dogeAdapter.checkPayment(base)).resolves.toMatchObject({
      status: "confirming",
      confirmations: 2,
    });
  });

  it("skips mempool txs, the merchant's own spends and pre-session txs when picking the hash", async () => {
    serve(() => ({
      data: {
        balance: "1500000000",
        transactions: [
          tx({ txid: "mempool", confirmations: 0 }),
          tx({ txid: "self-spend", vin: [{ addresses: [ADDR] }] }),
          tx({ txid: "unrelated", vout: [{ addresses: [BUYER], value: "5" }] }),
          tx({ txid: "pay" }),
          tx({ txid: "old", blockTime: now - 86_400 }),
        ],
      },
    }));
    const res = await dogeAdapter.checkPayment(base);
    expect(res.txHash).toBe("pay");
  });

  it("does not pick a deposit that predates the session", async () => {
    serve(() => ({
      data: { balance: "1500000000", transactions: [tx({ txid: "old", blockTime: now - 86_400 })] },
    }));
    const res = await dogeAdapter.checkPayment(base);
    expect(res).toMatchObject({ detected: true, status: "confirming" });
    expect(res.txHash).toBeUndefined();
  });

  it("keeps an attributed hash rather than switching to a newer deposit", async () => {
    serve(() => ({
      data: {
        balance: "2500000000",
        transactions: [tx({ txid: "next-buyer" }), tx({ txid: "mine", confirmations: 9 })],
      },
    }));
    const res = await dogeAdapter.checkPayment({ ...base, existingTxHash: "mine" });
    expect(res.txHash).toBe("mine");
    expect(res.confirmations).toBe(9);
  });

  it("settles on age when the tx can't be resolved", async () => {
    serve(() => ({ data: { balance: "1500000000", transactions: [] } }));
    const res = await dogeAdapter.checkPayment({
      ...base,
      firstDetectedAt: new Date(Date.now() - 7 * 60_000), // 7 one-minute blocks
    });
    expect(res).toMatchObject({ status: "confirmed" });
    expect(res.confirmations).toBeGreaterThanOrEqual(6);
  });

  it("throws when the address can't be read", async () => {
    serve(() => ({ status: 503, data: "" }));
    await expect(dogeAdapter.checkPayment(base)).rejects.toThrow();
  });

  it("does not read a merchant spend's change as a deposit", async () => {
    // The merchant spent 100 of 1000 DOGE; 899 came back as change. Lifetime
    // receipts went UP by 899 — the balance went DOWN by 101.
    serve(() => ({
      data: {
        balance: String(899e8),
        totalReceived: String(1899e8),
        transactions: [tx({ txid: "spend", vin: [{ addresses: [ADDR] }], vout: [{ addresses: [ADDR], value: String(899e8) }] })],
      },
    }));
    await expect(
      dogeAdapter.checkPayment({ ...base, balanceSnapshot: 1000 }),
    ).resolves.toEqual({ detected: false });
  });

  it("names the payment closest in value, not the newest (dust/poisoning)", async () => {
    serve(() => ({
      data: {
        balance: "1500000001",
        transactions: [
          tx({ txid: "dust", vout: [{ addresses: [ADDR], value: "1" }] }),
          tx({ txid: "pay", vout: [{ addresses: [ADDR], value: "1000000000" }] }),
        ],
      },
    }));
    const res = await dogeAdapter.checkPayment(base);
    expect(res.txHash).toBe("pay");
  });

  it("uses Zcash's own confirmation requirement", async () => {
    serve(() => ({
      data: {
        balance: "1500000000",
        transactions: [tx({ txid: "z", confirmations: 9, vout: [{ addresses: ["t1X"], value: "1" }] })],
      },
    }));
    // 9 < 10 required on Zcash (the tx doesn't pay this address, so only age counts).
    const res = await zecAdapter.checkPayment({ ...base, address: "t1Addr", token: "zec" });
    expect(res.status).toBe("confirming");
  });
});

describe("NowNodes credentials", () => {
  it("sends NOWNODES_API_KEY as api-key to nownodes.io only", () => {
    process.env.NOWNODES_API_KEY = "k";
    expect(headersFor("https://zecbook.nownodes.io")).toEqual({ "api-key": "k" });
    expect(headersFor("https://blockbook.zec.zelcore.io")).toEqual({});
    // A lookalike host must not receive the credential.
    expect(headersFor("https://nownodes.io.evil.example")).toEqual({});
    expect(headersFor("https://evilnownodes.io")).toEqual({});
  });

  it("sends nothing when no key is configured", () => {
    expect(headersFor("https://zecbook.nownodes.io")).toEqual({});
  });

  it("attaches the header on real requests, per endpoint", async () => {
    process.env.NOWNODES_API_KEY = "k";
    process.env.ZEC_API_URLS = "https://blockbook.zec.zelcore.io,https://zecbook.nownodes.io";
    const seen: { url: string; headers: Record<string, string> }[] = [];
    get.mockImplementation(async (url: string, cfg?: { headers?: unknown }) => {
      seen.push({ url, headers: (cfg?.headers ?? {}) as Record<string, string> });
      return { status: 502, statusText: "", data: "" };
    });
    await expect(zecAdapter.getBalanceSnapshot("t1XQZdZMnzXBcL8yx2PR27dSNrqctgwLgux")).rejects.toThrow();
    expect(seen).toHaveLength(2);
    for (const req of seen) {
      expect(req.headers["api-key"] === "k").toBe(req.url.startsWith("https://zecbook.nownodes.io"));
    }
  });
});
