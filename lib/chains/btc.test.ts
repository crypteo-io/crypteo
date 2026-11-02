import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BTC_SNAPSHOT_BASIS, btcAdapter } from "./btc";
import { resetEndpointPreferences } from "./rpc";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(axios.get);

const ADDR = "bc1qmerchant";
const BUYER = "bc1qbuyer";
const now = Math.floor(Date.now() / 1000);
const createdAt = new Date((now - 600) * 1000);

function serve(stats: { funded: number; spent: number }, txs: unknown[] = [], tip = 900) {
  get.mockImplementation(async (url: string) => {
    if (url.endsWith(`/address/${ADDR}`)) {
      return {
        status: 200,
        statusText: "",
        data: { chain_stats: { funded_txo_sum: stats.funded, spent_txo_sum: stats.spent } },
      };
    }
    if (url.endsWith("/txs")) return { status: 200, statusText: "", data: txs };
    if (url.endsWith("/blocks/tip/height")) return { status: 200, statusText: "", data: tip };
    throw new Error(`unrouted ${url}`);
  });
}

function tx(txid: string, sats: number, over: Record<string, unknown> = {}) {
  return {
    txid,
    status: { block_height: 899, block_time: now - 60 },
    vin: [{ prevout: { scriptpubkey_address: BUYER } }],
    vout: [{ scriptpubkey_address: ADDR, value: sats }],
    ...over,
  };
}

beforeEach(() => {
  resetEndpointPreferences();
  get.mockReset();
  delete process.env.BTC_API_URLS;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("btcAdapter snapshot basis", () => {
  it("snapshots new sessions on the confirmed balance and declares it", async () => {
    serve({ funded: 500_000_000, spent: 300_000_000 });
    expect(btcAdapter.snapshotBasis).toBe(BTC_SNAPSHOT_BASIS);
    await expect(btcAdapter.getBalanceSnapshot(ADDR)).resolves.toBe(2);
  });

  it("refuses a response without spent_txo_sum rather than guessing", async () => {
    get.mockResolvedValue({ status: 200, statusText: "", data: { chain_stats: { funded_txo_sum: 1 } } });
    await expect(btcAdapter.getBalanceSnapshot(ADDR)).rejects.toThrow(/unexpected response shape/);
  });

  it("does not read a merchant spend's change as a deposit (balance basis)", async () => {
    // Snapshot: 10 BTC balance. Merchant spends 1 BTC from 10, 8.9999 change
    // returns: funded +8.9999, spent +10 → balance 8.9999.
    serve(
      { funded: 1_000_000_000 + 899_990_000, spent: 1_000_000_000 },
      [tx("spend", 899_990_000, { vin: [{ prevout: { scriptpubkey_address: ADDR } }] })],
    );
    await expect(
      btcAdapter.checkPayment({
        address: ADDR,
        token: "btc",
        expectedAmount: 5,
        balanceSnapshot: 10,
        createdAt,
        snapshotBasis: BTC_SNAPSHOT_BASIS,
      }),
    ).resolves.toEqual({ detected: false });
  });

  it("detects a real deposit on the balance basis and reports the balance", async () => {
    serve({ funded: 1_200_000_000, spent: 200_000_000 }, [tx("pay", 50_000_000)]);
    const res = await btcAdapter.checkPayment({
      address: ADDR,
      token: "btc",
      expectedAmount: 0.5,
      balanceSnapshot: 9.5,
      createdAt,
      snapshotBasis: BTC_SNAPSHOT_BASIS,
    });
    expect(res).toMatchObject({
      detected: true,
      receivedAmount: 0.5,
      currentBalance: 10,
      txHash: "pay",
      confirmations: 2,
    });
  });

  it("keeps comparing a legacy (pre-switch) session against lifetime receipts", async () => {
    // Legacy snapshot was funded_txo_sum = 12 BTC; a 0.5 deposit makes it 12.5.
    // Under the balance basis this would read as a 9.5 BTC loss → no payment.
    serve({ funded: 1_250_000_000, spent: 300_000_000 }, [tx("pay", 50_000_000)]);
    const res = await btcAdapter.checkPayment({
      address: ADDR,
      token: "btc",
      expectedAmount: 0.5,
      balanceSnapshot: 12,
      createdAt,
      snapshotBasis: null,
    });
    expect(res).toMatchObject({ detected: true, receivedAmount: 0.5, currentBalance: 12.5 });
  });
});

describe("btcAdapter hash selection", () => {
  const base = {
    address: ADDR,
    token: "btc",
    expectedAmount: 0.5,
    balanceSnapshot: 9.5,
    createdAt,
    snapshotBasis: BTC_SNAPSHOT_BASIS,
  };

  it("never names the merchant's own spend, a mempool tx or dust", async () => {
    serve({ funded: 1_200_000_000, spent: 200_000_000 }, [
      tx("mempool", 50_000_000, { status: {} }),
      tx("sweep-change", 50_000_000, { vin: [{ prevout: { scriptpubkey_address: ADDR } }] }),
      tx("dust", 546),
      tx("pay", 50_000_000),
    ]);
    const res = await btcAdapter.checkPayment(base);
    expect(res.txHash).toBe("pay");
  });

  it("keeps an attributed hash", async () => {
    serve({ funded: 1_200_000_000, spent: 200_000_000 }, [tx("newer", 50_000_000), tx("mine", 50_000_000)]);
    const res = await btcAdapter.checkPayment({ ...base, existingTxHash: "mine" });
    expect(res.txHash).toBe("mine");
  });
});

describe("btcAdapter — one read per address per cycle", () => {
  it("serves two sessions on the same address from one stats read", async () => {
    serve({ funded: 1_200_000_000, spent: 200_000_000 }, [tx("pay", 50_000_000)]);
    const reads = new Map<string, Promise<unknown>>();
    const base = {
      address: ADDR,
      token: "btc",
      expectedAmount: 0.5,
      balanceSnapshot: 9.5,
      createdAt,
      snapshotBasis: BTC_SNAPSHOT_BASIS,
      reads,
    };
    await btcAdapter.checkPayment(base);
    await btcAdapter.checkPayment({ ...base, expectedAmount: 0.3 });
    const statsCalls = get.mock.calls.filter(([url]) => String(url).endsWith(`/address/${ADDR}`));
    expect(statsCalls).toHaveLength(1);
  });
});
