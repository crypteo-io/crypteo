import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEndpointPreferences } from "./rpc";
import { tronAdapter, tronAddressToHex, tronHexToAddress } from "./tron";

vi.mock("axios", () => ({ default: vi.fn() }));
const http = vi.mocked(axios as unknown as (cfg: { url: string; data?: unknown }) => Promise<unknown>);

const ADDR = "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL";
const SENDER = "TA4Y62o6YC2Zsck9rZVGTvqW1AQ7X9zTnj";

type Route = (url: string, body: unknown) => { status?: number; data: unknown } | undefined;

function serve(route: Route) {
  http.mockImplementation(async (cfg) => {
    const hit = route(cfg.url, cfg.data);
    if (!hit) throw new Error(`unrouted request: ${cfg.url}`);
    return { status: hit.status ?? 200, statusText: "", data: hit.data };
  });
}

beforeEach(() => {
  resetEndpointPreferences();
  http.mockReset();
  delete process.env.TRON_RPC_URLS;
  delete process.env.TRON_INDEXER_URLS;
  delete process.env.TRON_API_KEY;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Tron address conversion", () => {
  it("round-trips base58 ↔ 41-prefixed hex", () => {
    const hex = tronAddressToHex(ADDR);
    expect(hex).toMatch(/^41[0-9a-f]{40}$/);
    expect(tronHexToAddress(hex)).toBe(ADDR);
  });

  it("refuses a non-Tron address", () => {
    expect(() => tronAddressToHex("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toThrow(
      /invalid address/i,
    );
  });
});

describe("tronAdapter.getBalanceSnapshot", () => {
  it("reads TRX in sun", async () => {
    serve(() => ({ data: { address: ADDR, balance: 12_345_678 } }));
    await expect(tronAdapter.getBalanceSnapshot(ADDR, "trx")).resolves.toBe(12.345678);
  });

  it("treats an activated account with no balance field as zero", async () => {
    serve(() => ({ data: { address: ADDR } }));
    await expect(tronAdapter.getBalanceSnapshot(ADDR, "trx")).resolves.toBe(0);
  });

  it("treats an unactivated account ({}) as zero", async () => {
    serve(() => ({ data: {} }));
    await expect(tronAdapter.getBalanceSnapshot(ADDR, "trx")).resolves.toBe(0);
  });

  it("throws, never returns zero, when the node reports an error", async () => {
    serve(() => ({ data: { Error: "class org.tron.core... invalid address" } }));
    await expect(tronAdapter.getBalanceSnapshot(ADDR, "trx")).rejects.toThrow();
  });

  it("throws on an HTML overload page and on HTTP errors", async () => {
    serve(() => ({ data: "<html>busy</html>" }));
    await expect(tronAdapter.getBalanceSnapshot(ADDR, "trx")).rejects.toThrow();
    serve(() => ({ status: 503, data: {} }));
    await expect(tronAdapter.getBalanceSnapshot(ADDR, "trx")).rejects.toThrow();
  });

  it("throws on an unrecognised getaccount body rather than reading it as zero", async () => {
    serve(() => ({ data: { something: "else" } }));
    await expect(tronAdapter.getBalanceSnapshot(ADDR, "trx")).rejects.toThrow(
      /unexpected getaccount shape/,
    );
  });

  it("reads USDT via balanceOf with the padded 20-byte address", async () => {
    let body: Record<string, unknown> | undefined;
    serve((url, b) => {
      body = b as Record<string, unknown>;
      return url.endsWith("/wallet/triggerconstantcontract")
        ? {
            data: {
              result: { result: true },
              // 12.5 USDT at 6 decimals.
              constant_result: [(12_500_000).toString(16).padStart(64, "0")],
            },
          }
        : undefined;
    });
    await expect(tronAdapter.getBalanceSnapshot(ADDR, "usdt")).resolves.toBe(12.5);
    expect(body?.function_selector).toBe("balanceOf(address)");
    expect(body?.parameter).toBe(tronAddressToHex(ADDR).slice(2).padStart(64, "0"));
    expect(body?.contract_address).toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
  });

  it("throws when balanceOf did not execute", async () => {
    serve(() => ({ data: { result: { result: false, message: "REVERT" } } }));
    await expect(tronAdapter.getBalanceSnapshot(ADDR, "usdt")).rejects.toThrow(
      /balanceOf failed/,
    );
  });

  it("fails over to the second endpoint", async () => {
    serve((url) =>
      url.startsWith("https://api.trongrid.io")
        ? { status: 502, data: {} }
        : { data: { address: ADDR, balance: 1_000_000 } },
    );
    await expect(tronAdapter.getBalanceSnapshot(ADDR, "trx")).resolves.toBe(1);
  });

  it("sends TRON_API_KEY to TronGrid only", async () => {
    process.env.TRON_API_KEY = "secret";
    const seen: Record<string, unknown>[] = [];
    http.mockImplementation(async (cfg) => {
      seen.push(cfg as Record<string, unknown>);
      return { status: 502, statusText: "", data: {} };
    });
    await expect(tronAdapter.getBalanceSnapshot(ADDR, "trx")).rejects.toThrow();
    for (const req of seen) {
      const headers = req.headers as Record<string, string>;
      const isTronGrid = new URL(req.url as string).hostname.endsWith("trongrid.io");
      expect(headers["TRON-PRO-API-KEY"] === "secret").toBe(isTronGrid);
    }
    expect(seen.length).toBe(2);
  });
});

describe("tronAdapter.checkPayment", () => {
  const createdAt = new Date(Date.now() - 10 * 60_000);
  const base = {
    address: ADDR,
    expectedAmount: 10,
    balanceSnapshot: 5,
    createdAt,
  };

  function usdtBalance(units: number) {
    return {
      data: {
        result: { result: true },
        constant_result: [units.toString(16).padStart(64, "0")],
      },
    };
  }

  it("reports nothing when the balance has not risen", async () => {
    serve(() => usdtBalance(5_000_000));
    await expect(
      tronAdapter.checkPayment({ ...base, token: "usdt" }),
    ).resolves.toEqual({ detected: false });
  });

  it("confirms a deposit whose transfer is solidified", async () => {
    serve((url) => {
      if (url.endsWith("/wallet/triggerconstantcontract")) return usdtBalance(15_000_000);
      if (url.includes("/transactions/trc20") && url.includes("only_confirmed=true")) {
        return {
          data: {
            data: [
              { transaction_id: "abc", from: SENDER, to: ADDR, value: "10000000" },
            ],
          },
        };
      }
      return undefined;
    });
    const res = await tronAdapter.checkPayment({ ...base, token: "usdt" });
    expect(res).toMatchObject({
      detected: true,
      receivedAmount: 10,
      currentBalance: 15,
      txHash: "abc",
      fromAddress: SENDER,
      confirmations: 19,
      status: "confirmed",
    });
  });

  it("stays confirming while the transfer is only in the unconfirmed view", async () => {
    serve((url) => {
      if (url.endsWith("/wallet/triggerconstantcontract")) return usdtBalance(15_000_000);
      if (url.includes("only_confirmed=true")) return { data: { data: [] } };
      if (url.includes("only_unconfirmed=true")) {
        return {
          data: { data: [{ transaction_id: "pend", from: SENDER, to: ADDR, value: "10000000" }] },
        };
      }
      return undefined;
    });
    const res = await tronAdapter.checkPayment({ ...base, token: "usdt" });
    expect(res).toMatchObject({ detected: true, txHash: "pend", status: "confirming" });
    expect(res.confirmations).toBeLessThan(19);
  });

  it("still detects (balance-diff) when the indexer is down", async () => {
    serve((url) =>
      url.endsWith("/wallet/triggerconstantcontract")
        ? usdtBalance(15_000_000)
        : { status: 503, data: {} },
    );
    const res = await tronAdapter.checkPayment({ ...base, token: "usdt" });
    expect(res).toMatchObject({ detected: true, receivedAmount: 10, status: "confirming" });
    expect(res.txHash).toBeUndefined();
  });

  it("throws when the balance itself can't be read", async () => {
    serve(() => ({ status: 503, data: {} }));
    await expect(tronAdapter.checkPayment({ ...base, token: "usdt" })).rejects.toThrow();
  });

  it("resolves a TRX transfer from the account's transactions, matching on hex recipient", async () => {
    const ownHex = tronAddressToHex(ADDR);
    serve((url) => {
      if (url.endsWith("/wallet/getaccount")) return { data: { address: ADDR, balance: 15_000_000 } };
      if (url.includes("/transactions?") && url.includes("only_confirmed=true")) {
        return {
          data: {
            data: [
              // Failed transfer: must be skipped.
              {
                txID: "failed",
                ret: [{ contractRet: "REVERT" }],
                raw_data: { contract: [{ type: "TransferContract", parameter: { value: { amount: 10_000_000, to_address: ownHex, owner_address: tronAddressToHex(SENDER) } } }] },
              },
              // Resource delegation, not a payment.
              {
                txID: "delegate",
                ret: [{ contractRet: "SUCCESS" }],
                raw_data: { contract: [{ type: "UnDelegateResourceContract", parameter: { value: {} } }] },
              },
              {
                txID: "good",
                ret: [{ contractRet: "SUCCESS" }],
                raw_data: { contract: [{ type: "TransferContract", parameter: { value: { amount: 10_000_000, to_address: ownHex, owner_address: tronAddressToHex(SENDER) } } }] },
              },
            ],
          },
        };
      }
      return undefined;
    });
    const res = await tronAdapter.checkPayment({ ...base, token: "trx" });
    expect(res).toMatchObject({
      detected: true,
      txHash: "good",
      fromAddress: SENDER,
      status: "confirmed",
    });
  });

  it("re-confirms an attributed, solidified tx even after the wallet was swept", async () => {
    serve((url) =>
      url.endsWith("/walletsolidity/gettransactioninfobyid")
        ? { data: { id: "abc", receipt: { result: "SUCCESS" } } }
        : undefined,
    );
    const res = await tronAdapter.checkPayment({
      ...base,
      token: "usdt",
      existingTxHash: "abc",
      creditedAmount: 10,
    });
    expect(res).toMatchObject({
      detected: true,
      exclusive: true,
      txHash: "abc",
      receivedAmount: 10,
      status: "confirmed",
    });
  });

  it("never swaps an attributed hash for a newer transfer", async () => {
    serve((url) => {
      // Not solidified yet ({}), balance still shows the deposit.
      if (url.endsWith("/walletsolidity/gettransactioninfobyid")) return { data: {} };
      if (url.endsWith("/wallet/triggerconstantcontract")) return usdtBalance(15_000_000);
      if (url.includes("/transactions/trc20")) {
        return { data: { data: [{ transaction_id: "someone-else", from: SENDER, to: ADDR, value: "1" }] } };
      }
      return undefined;
    });
    const res = await tronAdapter.checkPayment({
      ...base,
      token: "usdt",
      existingTxHash: "abc",
      creditedAmount: 10,
    });
    expect(res.txHash).toBe("abc");
  });

  it("stops re-reporting a dust credit once settled underpaid, so the real payment counts", async () => {
    // 0.000001 USDT dust was credited first and the session settled underpaid.
    // The buyer's 10 USDT has since arrived.
    serve((url) => {
      if (url.endsWith("/walletsolidity/gettransactioninfobyid")) {
        return { data: { id: "dust", receipt: { result: "SUCCESS" } } };
      }
      if (url.endsWith("/wallet/triggerconstantcontract")) return usdtBalance(15_000_001);
      return { data: { data: [] } };
    });
    const res = await tronAdapter.checkPayment({
      ...base,
      token: "usdt",
      existingTxHash: "dust",
      creditedAmount: 0.000001,
      currentStatus: "underpaid",
    });
    // Fresh balance-diff detection, arbitrated by attribution — not the stale
    // exclusive re-report of the dust.
    expect(res.exclusive).toBeUndefined();
    expect(res.receivedAmount).toBe(10.000001);
  });

  it("still re-reports the credit while the session is confirming", async () => {
    serve((url) =>
      url.endsWith("/walletsolidity/gettransactioninfobyid")
        ? { data: { id: "abc", receipt: { result: "SUCCESS" } } }
        : undefined,
    );
    const res = await tronAdapter.checkPayment({
      ...base,
      token: "usdt",
      existingTxHash: "abc",
      creditedAmount: 5,
      currentStatus: "confirming",
    });
    expect(res).toMatchObject({ exclusive: true, receivedAmount: 5, status: "underpaid" });
  });

  it("names the transfer closest in value, not the newest poisoning dust", async () => {
    serve((url) => {
      if (url.endsWith("/wallet/triggerconstantcontract")) return usdtBalance(15_000_000);
      if (url.includes("only_confirmed=true")) {
        return {
          data: {
            data: [
              // Newest first, as TronGrid orders them: the lookalike's dust.
              { transaction_id: "poison", from: "TLookalike", to: ADDR, value: "1" },
              { transaction_id: "zero", from: "TLookalike", to: ADDR, value: "0" },
              { transaction_id: "real", from: SENDER, to: ADDR, value: "10000000" },
            ],
          },
        };
      }
      return undefined;
    });
    const res = await tronAdapter.checkPayment({ ...base, token: "usdt" });
    expect(res).toMatchObject({ txHash: "real", fromAddress: SENDER });
  });
});
