/**
 * Probe every configured chain endpoint for the exact methods the adapters
 * call, and report which work.
 *
 * A provider serving getBalance tells you nothing about whether it serves the
 * indexed methods that read an SPL balance — that gap is what made every
 * Solana stablecoin deposit undetectable. Run this after changing any
 * *_RPC_URLS value, and before pointing production at a new provider.
 *
 *   npx tsx scripts/verify-rpc.ts
 */
import axios from "axios";
import "dotenv/config";
import { headersFor as blockbookHeaders } from "../lib/chains/blockbook";
import { headersFor as koiosHeaders } from "../lib/chains/cardano";
import { builtInEndpoints, resolveEndpoints } from "../lib/chains/rpc";
import { headersFor as tronHeaders } from "../lib/chains/tron";
import { getProxyAgent, getRandomProxy } from "../lib/proxy-rotation";
import { syncProxies } from "../lib/proxy-settings";

const SOL_WALLET = "ACTceHEAZYvx4kaukH5aByWo1ckf6Nh9R2iG27XSkN5D";
const SOL_ATA = "EatsupQXixLzi25PNJJPgLqkjpTVnKWQ42EFD3coquCr";
const SOL_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const ETH_WALLET = "0x6d7f880dDDBCb37d721e0d5D7a0d2bE2Bc9aDC96";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const EVM_HOLDER = "0xF977814e90dA44bFA03b6295A0616a897441aceC";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const POLYGON_USDT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const TRON_ACCT = "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL";
const TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const DOGE_ADDR = "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L";
const ZEC_ADDR = "t1XQZdZMnzXBcL8yx2PR27dSNrqctgwLgux";
const ADA_ADDR =
  "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";
const BTC_ADDR = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const XRP_ACCT = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** Never print an API key, even to a terminal that may be pasted somewhere. */
function mask(url: string): string {
  return url
    .replace(/(api[-_]?key=)[^&\s,]+/gi, "$1****")
    .replace(/(\/v[23]\/)[^/\s,]+/gi, "$1****")
    .replace(/(\/)[0-9a-f]{32,}(\/|$)/gi, "$1****$2");
}

const useProxy = process.argv.includes("--proxy");

// Provider credentials, from the adapters' own helpers so this probe sends
// exactly what a poll would (each only to its own provider's host).
function credentials(url: string): Record<string, string> {
  return { ...tronHeaders(url), ...koiosHeaders(url), ...blockbookHeaders(url) };
}

async function post(url: string, body: unknown, timeout = 15000) {
  const agent = useProxy ? getProxyAgent(getRandomProxy()) : null;
  const res = await axios.post(url, body, {
    timeout,
    httpAgent: agent,
    httpsAgent: agent,
    proxy: false,
    validateStatus: () => true,
    headers: { "Content-Type": "application/json", ...credentials(url) },
  });
  return res;
}

function rpcOk(res: { status: number; data: unknown }): string | null {
  const d = res.data as { result?: unknown; error?: { message?: string } };
  if (d && typeof d === "object" && "result" in d && d.result !== undefined) {
    return null;
  }
  const msg =
    d?.error?.message ??
    (typeof res.data === "string"
      ? res.data.slice(0, 90)
      : JSON.stringify(res.data).slice(0, 90));
  return `HTTP ${res.status}: ${msg}`;
}

type Check = { name: string; run: (url: string) => Promise<string | null> };

function jsonRpc(name: string, method: string, params: unknown): Check {
  return {
    name,
    run: async (url) =>
      rpcOk(await post(url, { jsonrpc: "2.0", id: 1, method, params })),
  };
}

const SOL_CHECKS: Check[] = [
  jsonRpc("getBalance", "getBalance", [SOL_WALLET]),
  jsonRpc("getTokenAccountsByOwner*", "getTokenAccountsByOwner", [
    SOL_WALLET,
    { mint: SOL_MINT },
    { encoding: "jsonParsed" },
  ]),
  jsonRpc("getTokenAccountBalance*", "getTokenAccountBalance", [SOL_ATA]),
  jsonRpc("getSignaturesForAddress", "getSignaturesForAddress", [
    SOL_ATA,
    { limit: 2 },
  ]),
];

function evmChecks(token: string, holder: string): Check[] {
  return [
  jsonRpc("eth_blockNumber", "eth_blockNumber", []),
  jsonRpc("eth_call (balanceOf)*", "eth_call", [
    { to: token, data: `0x70a08231000000000000000000000000${holder.slice(2)}` },
    "latest",
  ]),
  {
    name: "eth_getLogs (50 blk)",
    run: async (url) => {
      const head = await post(url, {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [],
      });
      const h = (head.data as { result?: string })?.result;
      if (!h) return "could not read head block";
      const n = parseInt(h, 16);
      return rpcOk(
        await post(url, {
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getLogs",
          params: [
            {
              fromBlock: "0x" + (n - 49).toString(16),
              toBlock: "0x" + n.toString(16),
              address: token,
              topics: [TRANSFER_TOPIC],
            },
          ],
        }),
      );
    },
  },
];
}

const ETH_CHECKS = evmChecks(USDT, ETH_WALLET);
const BSC_CHECKS = evmChecks(BSC_USDT, EVM_HOLDER);
const POLYGON_CHECKS = evmChecks(POLYGON_USDT, EVM_HOLDER);

const XRP_CHECKS: Check[] = [
  {
    name: "account_info*",
    run: async (url) => {
      const res = await post(url, {
        method: "account_info",
        params: [{ account: XRP_ACCT, ledger_index: "validated" }],
      });
      const d = res.data as { result?: { error?: string } };
      if (res.status >= 400 || d?.result?.error)
        return `HTTP ${res.status}: ${d?.result?.error ?? "error"}`;
      return d?.result ? null : "no result";
    },
  },
  {
    name: "account_tx",
    run: async (url) => {
      const res = await post(url, {
        method: "account_tx",
        params: [{ account: XRP_ACCT, limit: 2 }],
      });
      const d = res.data as { result?: { error?: string } };
      if (res.status >= 400 || d?.result?.error)
        return `HTTP ${res.status}: ${d?.result?.error ?? "error"}`;
      return d?.result ? null : "no result";
    },
  },
];

const BTC_CHECKS: Check[] = [
  {
    name: "address stats*",
    run: async (base) => {
      const agent = useProxy ? getProxyAgent(getRandomProxy()) : null;
      const res = await axios.get(`${base}/address/${BTC_ADDR}`, {
        timeout: 15000,
        httpsAgent: agent,
        proxy: false,
        validateStatus: () => true,
      });
      if (res.status !== 200) return `HTTP ${res.status}`;
      const d = res.data as { chain_stats?: { funded_txo_sum?: number } };
      return typeof d?.chain_stats?.funded_txo_sum === "number"
        ? null
        : "unexpected response shape";
    },
  },
  {
    name: "tip height",
    run: async (base) => {
      const agent = useProxy ? getProxyAgent(getRandomProxy()) : null;
      const res = await axios.get(`${base}/blocks/tip/height`, {
        timeout: 15000,
        httpsAgent: agent,
        proxy: false,
        validateStatus: () => true,
      });
      if (res.status !== 200) return `HTTP ${res.status}`;
      return typeof res.data === "number" ? null : "unexpected response shape";
    },
  },
];

async function getJson(url: string) {
  const agent = useProxy ? getProxyAgent(getRandomProxy()) : null;
  return axios.get(url, {
    headers: credentials(url),
    timeout: 15000,
    httpsAgent: agent,
    proxy: false,
    validateStatus: () => true,
  });
}

function shapeOk(
  res: { status: number; data: unknown },
  ok: (d: unknown) => boolean,
): string | null {
  if (res.status !== 200) return `HTTP ${res.status}`;
  return ok(res.data) ? null : "unexpected response shape";
}

const TRON_CHECKS: Check[] = [
  {
    name: "getaccount*",
    run: async (url) =>
      shapeOk(
        await post(`${url}/wallet/getaccount`, {
          address: TRON_ACCT,
          visible: true,
        }),
        (d) => typeof (d as { address?: unknown })?.address === "string",
      ),
  },
  {
    name: "triggerconstantcontract*",
    run: async (url) =>
      shapeOk(
        await post(`${url}/wallet/triggerconstantcontract`, {
          owner_address: TRON_ACCT,
          contract_address: TRON_USDT,
          function_selector: "decimals()",
          parameter: "",
          visible: true,
        }),
        (d) =>
          Array.isArray((d as { constant_result?: unknown })?.constant_result),
      ),
  },
];

const TRON_INDEXER_CHECKS: Check[] = [
  {
    name: "v1 trc20 transfers",
    run: async (url) =>
      shapeOk(
        await getJson(
          `${url}/v1/accounts/${TRON_ACCT}/transactions/trc20?only_to=true&limit=1`,
        ),
        (d) => Array.isArray((d as { data?: unknown })?.data),
      ),
  },
];

function blockbookChecks(address: string): Check[] {
  return [
    {
      name: "address totalReceived*",
      run: async (url) =>
        shapeOk(
          await getJson(`${url}/api/v2/address/${address}?details=basic`),
          (d) =>
            typeof (d as { totalReceived?: unknown })?.totalReceived ===
            "string",
        ),
    },
  ];
}

const ADA_CHECKS: Check[] = [
  {
    name: "address_info*",
    run: async (url) =>
      shapeOk(
        await post(`${url}/address_info`, { _addresses: [ADA_ADDR] }),
        (d) => Array.isArray(d),
      ),
  },
  {
    name: "tip",
    run: async (url) =>
      shapeOk(await getJson(`${url}/tip`), (d) => Array.isArray(d)),
  },
];

const CHAINS = [
  { chain: "sol", env: "SOLANA_RPC_URLS", defaults: [] as string[], checks: SOL_CHECKS },
  { chain: "eth", env: "ETH_RPC_URLS", defaults: [] as string[], checks: ETH_CHECKS },
  { chain: "btc", env: "BTC_API_URLS", defaults: [] as string[], checks: BTC_CHECKS },
  { chain: "xrp", env: "XRP_RPC_URLS", defaults: [] as string[], checks: XRP_CHECKS },
  { chain: "bsc", env: "BSC_RPC_URLS", defaults: [] as string[], checks: BSC_CHECKS },
  { chain: "polygon", env: "POLYGON_RPC_URLS", defaults: [] as string[], checks: POLYGON_CHECKS },
  { chain: "tron", env: "TRON_RPC_URLS", defaults: [] as string[], checks: TRON_CHECKS },
  { chain: "tron (indexer)", env: "TRON_INDEXER_URLS", defaults: [] as string[], checks: TRON_INDEXER_CHECKS },
  { chain: "doge", env: "DOGE_API_URLS", defaults: [] as string[], checks: blockbookChecks(DOGE_ADDR) },
  { chain: "zec", env: "ZEC_API_URLS", defaults: [] as string[], checks: blockbookChecks(ZEC_ADDR) },
  { chain: "ada", env: "KOIOS_API_URLS", defaults: [] as string[], checks: ADA_CHECKS },
];

// Pull the real defaults from the adapters so this cannot drift from them.
async function defaultsFor(env: string): Promise<string[]> {
  const saved = process.env[env];
  delete process.env[env];
  const mod = {
    SOLANA_RPC_URLS: () => import("../lib/chains/solana"),
    ETH_RPC_URLS: () => import("../lib/chains/evm"),
    BTC_API_URLS: () => import("../lib/chains/btc"),
    XRP_RPC_URLS: () => import("../lib/chains/xrp"),
    BSC_RPC_URLS: () => import("../lib/chains/evm"),
    POLYGON_RPC_URLS: () => import("../lib/chains/evm"),
    TRON_RPC_URLS: () => import("../lib/chains/tron"),
    TRON_INDEXER_URLS: () => import("../lib/chains/tron"),
    DOGE_API_URLS: () => import("../lib/chains/blockbook"),
    ZEC_API_URLS: () => import("../lib/chains/blockbook"),
    KOIOS_API_URLS: () => import("../lib/chains/cardano"),
  }[env];
  await mod?.();
  // Adapters register their built-in lists at load time.
  const list = builtInEndpoints(env);
  if (saved !== undefined) process.env[env] = saved;
  return list;
}

async function main() {
  if (useProxy) await syncProxies();
  console.log(
    `Probing chain endpoints${useProxy ? " through the proxy pool" : " directly (pass --proxy to use proxies)"}\n`,
  );

  let anyCritical = false;

  for (const { chain, env, checks } of CHAINS) {
    const configured = resolveEndpoints(env, []);
    const fromEnv = configured.length > 0;
    const endpoints = fromEnv ? configured : await defaultsFor(env);

    console.log(
      `── ${chain.toUpperCase()}  (${fromEnv ? `${env}, ${endpoints.length} endpoint(s)` : "built-in defaults"})`,
    );
    if (endpoints.length === 0) {
      console.log("   no endpoints resolved\n");
      continue;
    }

    const criticalCovered = new Set<string>();
    for (const url of endpoints) {
      const results = await Promise.all(
        checks.map(async (c) => {
          try {
            return { name: c.name, err: await c.run(url) };
          } catch (e) {
            return {
              name: c.name,
              err: e instanceof Error ? e.message.slice(0, 90) : String(e),
            };
          }
        }),
      );
      const ok = results.filter((r) => !r.err).map((r) => r.name);
      const bad = results.filter((r) => r.err);
      for (const n of ok) if (n.endsWith("*")) criticalCovered.add(n);

      console.log(`   ${mask(url)}`);
      console.log(`      serves : ${ok.length ? ok.join(", ") : "(nothing)"}`);
      for (const b of bad) console.log(`      FAILS  : ${b.name}: ${b.err}`);
    }

    // A method marked * is required to detect a payment. If no endpoint in the
    // list serves it, that chain/token pair is blind.
    const critical = checks.filter((c) => c.name.endsWith("*")).map((c) => c.name);
    const missing = critical.filter((c) => !criticalCovered.has(c));
    if (missing.length) {
      anyCritical = true;
      console.log(
        `   >> CRITICAL: no endpoint serves ${missing.join(", ")}, so payments on this chain cannot be detected`,
      );
    } else {
      console.log(`   >> all detection-critical methods covered`);
    }
    console.log("");
  }

  console.log(
    anyCritical
      ? "RESULT: at least one chain cannot detect payments with the current configuration."
      : "RESULT: every chain can detect payments.",
  );
  process.exit(anyCritical ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
