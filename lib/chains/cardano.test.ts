import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCKFROST_URL, cardanoAdapter } from "./cardano";
import { resetEndpointPreferences } from "./rpc";

vi.mock("axios", () => ({ default: vi.fn() }));
const http = vi.mocked(axios as unknown as (cfg: { url: string }) => Promise<unknown>);

const ADDR =
  "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";

function serve(route: (url: string) => { status?: number; data: unknown } | undefined) {
  http.mockImplementation(async (cfg) => {
    const hit = route(cfg.url);
    if (!hit) throw new Error(`unrouted request: ${cfg.url}`);
    return { status: hit.status ?? 200, statusText: "", data: hit.data };
  });
}

const now = Math.floor(Date.now() / 1000);
const createdAt = new Date((now - 600) * 1000);

beforeEach(() => {
  resetEndpointPreferences();
  http.mockReset();
  delete process.env.KOIOS_API_URLS;
  delete process.env.KOIOS_API_TOKEN;
  delete process.env.BLOCKFROST_PROJECT_ID;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("cardanoAdapter.getBalanceSnapshot", () => {
  it("reads the balance in lovelace", async () => {
    serve(() => ({ data: [{ balance: "12500000", utxo_set: [] }] }));
    await expect(cardanoAdapter.getBalanceSnapshot(ADDR)).resolves.toBe(12.5);
  });

  it("reads an address the chain has never seen ([]) as zero", async () => {
    serve(() => ({ data: [] }));
    await expect(cardanoAdapter.getBalanceSnapshot(ADDR)).resolves.toBe(0);
  });

  it("throws on anything that isn't the expected list", async () => {
    serve(() => ({ data: { message: "rate limited" } }));
    await expect(cardanoAdapter.getBalanceSnapshot(ADDR)).rejects.toThrow();
    serve(() => ({ data: [{ balance: 5 }] }));
    await expect(cardanoAdapter.getBalanceSnapshot(ADDR)).rejects.toThrow();
    serve(() => ({ status: 429, data: [] }));
    await expect(cardanoAdapter.getBalanceSnapshot(ADDR)).rejects.toThrow(/429/);
  });

  it("sends KOIOS_API_TOKEN to Koios only", async () => {
    process.env.KOIOS_API_TOKEN = "tok";
    process.env.KOIOS_API_URLS = "https://api.koios.rest/api/v1,https://mirror.example/api/v1";
    const seen: { url: string; headers: Record<string, string> }[] = [];
    http.mockImplementation(async (cfg) => {
      seen.push(cfg as { url: string; headers: Record<string, string> });
      return { status: 502, statusText: "", data: "" };
    });
    await expect(cardanoAdapter.getBalanceSnapshot(ADDR)).rejects.toThrow();
    expect(seen).toHaveLength(2);
    for (const req of seen) {
      expect(req.headers.Authorization === "Bearer tok").toBe(
        req.url.startsWith("https://api.koios.rest"),
      );
    }
  });
});

describe("cardanoAdapter.checkPayment", () => {
  const base = { address: ADDR, token: "ada", expectedAmount: 10, balanceSnapshot: 5, createdAt };

  it("reports nothing when the balance hasn't risen", async () => {
    serve(() => ({ data: [{ balance: "5000000", utxo_set: [] }] }));
    await expect(cardanoAdapter.checkPayment(base)).resolves.toEqual({ detected: false });
  });

  it("finds the newest post-session UTXO and counts confirmations from the tip", async () => {
    serve((url) => {
      if (url.endsWith("/address_info")) {
        return {
          data: [
            {
              balance: "15000000",
              utxo_set: [
                { tx_hash: "old", value: "5000000", block_height: 100, block_time: now - 86_400 },
                { tx_hash: "pay", value: "10000000", block_height: 200, block_time: now - 60 },
              ],
            },
          ],
        };
      }
      if (url.endsWith("/tip")) return { data: [{ block_no: 219 }] };
      return undefined;
    });
    await expect(cardanoAdapter.checkPayment(base)).resolves.toMatchObject({
      detected: true,
      receivedAmount: 10,
      txHash: "pay",
      confirmations: 20,
      status: "confirmed",
    });
  });

  it("stays confirming below 15 confirmations", async () => {
    serve((url) =>
      url.endsWith("/address_info")
        ? {
            data: [
              {
                balance: "15000000",
                utxo_set: [{ tx_hash: "pay", value: "10000000", block_height: 200, block_time: now - 30 }],
              },
            ],
          }
        : { data: [{ block_no: 203 }] },
    );
    await expect(cardanoAdapter.checkPayment(base)).resolves.toMatchObject({
      status: "confirming",
      confirmations: 4,
    });
  });

  it("does not attribute a UTXO that predates the session", async () => {
    serve(() => ({
      data: [
        {
          balance: "15000000",
          utxo_set: [{ tx_hash: "old", value: "10000000", block_height: 100, block_time: now - 86_400 }],
        },
      ],
    }));
    const res = await cardanoAdapter.checkPayment(base);
    expect(res).toMatchObject({ detected: true, status: "confirming" });
    expect(res.txHash).toBeUndefined();
  });

  it("keeps an attributed hash and still detects when the tip is unreachable", async () => {
    serve((url) =>
      url.endsWith("/address_info")
        ? {
            data: [
              {
                balance: "25000000",
                utxo_set: [
                  { tx_hash: "mine", value: "10000000", block_height: 200, block_time: now - 120 },
                  { tx_hash: "next-buyer", value: "10000000", block_height: 210, block_time: now - 30 },
                ],
              },
            ],
          }
        : { status: 503, data: "" },
    );
    const res = await cardanoAdapter.checkPayment({ ...base, existingTxHash: "mine" });
    expect(res).toMatchObject({ detected: true, txHash: "mine" });
  });

  it("throws when the address can't be read", async () => {
    serve(() => ({ status: 503, data: "" }));
    await expect(cardanoAdapter.checkPayment(base)).rejects.toThrow();
  });

  it("names the UTXO closest in value, not the newest", async () => {
    serve((url) =>
      url.endsWith("/address_info")
        ? {
            data: [
              {
                balance: "15000000",
                utxo_set: [
                  { tx_hash: "pay", value: "10000000", block_height: 200, block_time: now - 120 },
                  { tx_hash: "dust", value: "1000000", block_height: 205, block_time: now - 30 },
                ],
              },
            ],
          }
        : { data: [{ block_no: 230 }] },
    );
    const res = await cardanoAdapter.checkPayment(base);
    expect(res.txHash).toBe("pay");
  });
});

describe("cardanoAdapter through Blockfrost", () => {
  const base = { address: ADDR, token: "ada", expectedAmount: 10, balanceSnapshot: 5, createdAt };
  const koios429 = (url: string) =>
    url.startsWith("https://api.koios.rest") ? { status: 429, data: "" } : undefined;

  beforeEach(() => {
    process.env.BLOCKFROST_PROJECT_ID = "mainnetKey";
  });

  it("is not used without a project id", async () => {
    delete process.env.BLOCKFROST_PROJECT_ID;
    serve((url) => koios429(url));
    await expect(cardanoAdapter.getBalanceSnapshot(ADDR)).rejects.toThrow(/429/);
    expect(http.mock.calls.every(([cfg]) => !cfg.url.startsWith(BLOCKFROST_URL))).toBe(true);
  });

  it("reads the balance when Koios is rate-limited, sending the key to Blockfrost only", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    http.mockImplementation(async (cfg) => {
      const req = cfg as { url: string; headers: Record<string, string> };
      seen.push(req);
      if (req.url.startsWith("https://api.koios.rest")) return { status: 429, statusText: "", data: "" };
      return {
        status: 200,
        statusText: "",
        data: { amount: [{ unit: "lovelace", quantity: "12500000" }, { unit: "abc123", quantity: "7" }] },
      };
    });
    await expect(cardanoAdapter.getBalanceSnapshot(ADDR)).resolves.toBe(12.5);
    for (const req of seen) {
      expect(req.headers.project_id === "mainnetKey").toBe(req.url.startsWith(BLOCKFROST_URL));
    }
  });

  it("reads Blockfrost's not-found as an address never seen, and nothing else as zero", async () => {
    serve((url) => koios429(url) ?? { status: 404, data: { status_code: 404, error: "Not Found" } });
    await expect(cardanoAdapter.getBalanceSnapshot(ADDR)).resolves.toBe(0);
    resetEndpointPreferences();
    serve((url) => koios429(url) ?? { status: 402, data: { status_code: 402, error: "Project Over Limit" } });
    await expect(cardanoAdapter.getBalanceSnapshot(ADDR)).rejects.toThrow();
    resetEndpointPreferences();
    serve((url) => koios429(url) ?? { data: { amount: [{ unit: "lovelace", quantity: "-1" }] } });
    await expect(cardanoAdapter.getBalanceSnapshot(ADDR)).rejects.toThrow();
  });

  it("detects a payment from UTXOs dated by the address's transactions", async () => {
    serve((url) => {
      if (koios429(url)) return koios429(url);
      if (url.includes("/utxos")) {
        return {
          data: [
            { tx_hash: "pay", amount: [{ unit: "lovelace", quantity: "10000000" }] },
            { tx_hash: "ancient", amount: [{ unit: "lovelace", quantity: "5000000" }] },
          ],
        };
      }
      if (url.includes("/transactions")) {
        return { data: [{ tx_hash: "pay", block_height: 200, block_time: now - 60 }] };
      }
      if (url.endsWith("/blocks/latest")) return { data: { height: 219 } };
      if (url.includes("/addresses/")) {
        return { data: { amount: [{ unit: "lovelace", quantity: "15000000" }] } };
      }
      return undefined;
    });
    await expect(cardanoAdapter.checkPayment(base)).resolves.toMatchObject({
      detected: true,
      receivedAmount: 10,
      txHash: "pay",
      confirmations: 20,
      status: "confirmed",
    });
  });
});
