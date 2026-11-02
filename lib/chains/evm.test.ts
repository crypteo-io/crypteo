import { describe, expect, it, vi } from "vitest";
import {
  bscAdapter,
  closestTransfer,
  makeEvmProvider,
  evmAdapter,
  logScanIsFutile,
  lookbackForAge,
  polygonAdapter,
} from "./evm";

const NOW = new Date("2026-10-12T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("EVM adapters", () => {
  it("each accept their own native token plus USDC/USDT", () => {
    expect(evmAdapter.chain).toBe("eth");
    expect(evmAdapter.supportedTokens).toEqual(["ETH", "USDC", "USDT"]);
    expect(bscAdapter.chain).toBe("bsc");
    expect(bscAdapter.supportedTokens.sort()).toEqual(["BNB", "USDC", "USDT"]);
    expect(polygonAdapter.chain).toBe("polygon");
    expect(polygonAdapter.supportedTokens.sort()).toEqual(["POL", "USDC", "USDT"]);
  });
});

describe("lookbackForAge", () => {
  it("keeps Ethereum's behaviour: session age at 12s blocks, up to a day", () => {
    expect(lookbackForAge("eth", ago(60 * 60_000), NOW)).toBe(300 + 50);
    expect(lookbackForAge("eth", ago(48 * 60 * 60_000), NOW)).toBe(7_200);
    expect(lookbackForAge("eth", ago(0), NOW)).toBe(100);
  });

  it("uses each chain's block time and cap", () => {
    // Sized by the measured (fast) block time, so the walk covers the whole
    // session: 10 min of 450ms blocks = 1334, +50 buffer.
    expect(lookbackForAge("bsc", ago(10 * 60_000), NOW)).toBe(1_384);
    expect(lookbackForAge("bsc", ago(6 * 60 * 60_000), NOW)).toBe(2_400);
    expect(lookbackForAge("polygon", ago(10 * 60_000), NOW)).toBe(450);
    expect(lookbackForAge("polygon", ago(6 * 60 * 60_000), NOW)).toBe(1_800);
  });
});

describe("logScanIsFutile", () => {
  it("is never futile on first detection", () => {
    expect(logScanIsFutile("bsc", undefined, NOW)).toBe(false);
  });

  it("is futile once the deposit is older than the walk can reach", () => {
    // BSC window: 2400 × 450ms = 18 min.
    expect(logScanIsFutile("bsc", ago(17 * 60_000), NOW)).toBe(false);
    expect(logScanIsFutile("bsc", ago(19 * 60_000), NOW)).toBe(true);
    // Ethereum's day-long window is unchanged in practice: confirming
    // sessions time out at 24h.
    expect(logScanIsFutile("eth", ago(23 * 60 * 60_000), NOW)).toBe(false);
  });
});

describe("closestTransfer", () => {
  const log = (units: bigint, id: string) => ({
    id,
    data: "0x" + units.toString(16).padStart(64, "0"),
  });

  it("ignores zero-value poisoning transfers", () => {
    const real = log(BigInt(25_000_000), "real");
    const poison = log(BigInt(0), "poison");
    expect(closestTransfer([real, poison], 6, 25)?.id).toBe("real");
    expect(closestTransfer([poison], 6, 25)).toBeNull();
  });

  it("picks the value closest to what arrived, not the newest", () => {
    const logs = [log(BigInt(25_000_000), "real"), log(BigInt(1), "dust")];
    expect(closestTransfer(logs, 6, 25)?.id).toBe("real");
  });

  it("keeps the newest on a tie", () => {
    const logs = [log(BigInt(10_000_000), "older"), log(BigInt(10_000_000), "newer")];
    expect(closestTransfer(logs, 6, 10)?.id).toBe("newer");
  });

  it("reads 18-decimal BEP-20 values correctly", () => {
    const logs = [log(BigInt(10) ** BigInt(19), "ten"), log(BigInt(10) ** BigInt(18), "one")];
    expect(closestTransfer(logs, 18, 1)?.id).toBe("one");
  });

  it("skips a malformed payload instead of throwing", () => {
    expect(closestTransfer([{ id: "bad", data: "0xzz" }], 6, 1)).toBeNull();
  });
});

describe("EVM provider", () => {
  it("never batches concurrent JSON-RPC calls (free tiers reject batches)", async () => {
    const { ethers } = await import("ethers");
    const seen: number[] = [];
    const spy = vi
      .spyOn(ethers.JsonRpcProvider.prototype, "_send")
      .mockImplementation(async (payload) => {
        const batch = Array.isArray(payload) ? payload : [payload];
        seen.push(batch.length);
        return batch.map((p) => ({ id: p.id, jsonrpc: "2.0", result: "0x64" }));
      });
    const provider = makeEvmProvider("bsc", "https://rpc.test");
    // Concurrent calls on ONE provider are what ethers folds into a batch.
    // Distinct requests, like the native scan's five different blocks
    // (identical ones are coalesced and never reach the wire).
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => provider.send("eth_getBlockByNumber", [`0x${i + 1}`, true])),
    );
    expect(seen.length).toBe(5);
    expect(Math.max(...seen)).toBe(1);
    spy.mockRestore();
  });
});
