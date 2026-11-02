import axios from "axios";
import { ethers, Network } from "ethers";
import {
  balanceDelta,
  classifyAmount,
  confirmationsFromAge,
  EVM_CHAINS,
  type EvmChainConfig,
  requiredConfirmations,
  shouldRedetectUnderpaid,
} from "./config";
import { cachedRead } from "./reads";
import type {
  ChainAdapter,
  CheckPaymentParams,
  PaymentCheckResult,
} from "./interface";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

import {
  defineEndpoints,
  isEndpointRefusal,
  type RpcAttempt,
  resolveEndpoints,
  withEndpointFailover,
} from "./rpc";

/** Everything that differs between EVM chains; the detection logic doesn't. */
interface EvmNetwork {
  chain: string;
  config: EvmChainConfig;
  rpcEnv: string;
  defaultUrls: readonly string[];
  // Pinning the network stops ethers running its own "detect network" probe,
  // whose retry loop fires before our failover can move on.
  network: Network;
}

/** A provider for `chain` at `url` (no proxy), as the adapters build it. */
export function makeEvmProvider(chain: string, url: string): ethers.JsonRpcProvider {
  const network = Network.from(EVM_CHAINS[chain].chainId);
  return makeProvider(
    { chain, config: EVM_CHAINS[chain], rpcEnv: "", defaultUrls: [], network },
    { url, agent: null },
  );
}

function makeProvider(
  net: EvmNetwork,
  { url, agent }: RpcAttempt,
): ethers.JsonRpcProvider {
  const fetchReq = new ethers.FetchRequest(url);
  if (agent) {
    fetchReq.getUrlFunc = async (req) => {
      const res = await axios({
        url: req.url,
        method: req.method,
        headers: req.headers,
        data: req.body,
        httpsAgent: agent,
        httpAgent: agent,
        proxy: false,
        timeout: 8_000,
        responseType: "arraybuffer", // Get raw bytes for Ethers parser
        validateStatus: () => true,
      });
      return {
        statusCode: res.status,
        statusMessage: res.statusText,
        headers: res.headers as Record<string, string>,
        body: new Uint8Array(res.data),
      };
    };
  }
  return new ethers.JsonRpcProvider(fetchReq, net.network, {
    staticNetwork: net.network,
    // One request per HTTP call. ethers otherwise folds concurrent calls into
    // a JSON-RPC batch, and free tiers cap batch size: drpc rejects a batch
    // of more than 3 outright ("Batch of more than 3 requests are not allowed
    // on free plan", seen 2026-10-13), so the native scan's parallel
    // getBlock calls failed the whole attempt and cooled the endpoint down.
    batchMaxCount: 1,
  });
}

/** One EVM operation, failing over across endpoints. The operation is the
 * probe: a cheap health check proves nothing about the method you need. */
async function evmRpc<T>(
  net: EvmNetwork,
  label: string,
  fn: (provider: ethers.JsonRpcProvider) => Promise<T>,
): Promise<T> {
  return withEndpointFailover(
    net.rpcEnv,
    resolveEndpoints(net.rpcEnv, net.defaultUrls),
    `${net.chain} ${label}`,
    (attempt) => fn(makeProvider(net, attempt)),
  );
}

// Read the native or ERC-20 balance for `address` using an already-constructed
// provider.
async function readBalanceWith(
  net: EvmNetwork,
  provider: ethers.JsonRpcProvider,
  address: string,
  token: string,
): Promise<number> {
  const lowerToken = token.toLowerCase();
  if (lowerToken === net.config.nativeToken) {
    const balance = await provider.getBalance(address);
    return parseFloat(ethers.formatEther(balance));
  }
  const tokenConfig = net.config.tokens[lowerToken];
  // Fail loudly. Without this an unconfigured token constructs a contract at
  // `undefined` and dies inside ethers with an opaque error, which reads as a
  // transient RPC fault and gets retried forever instead of being fixed.
  if (!tokenConfig) {
    throw new Error(
      `No ERC-20 configuration for token "${token}" on ${net.chain}`,
    );
  }
  const contract = new ethers.Contract(
    tokenConfig.contract,
    ERC20_ABI,
    provider,
  );
  const balance = await contract.balanceOf(address);
  return parseFloat(ethers.formatUnits(balance, tokenConfig.decimals));
}

/** Native or ERC-20 balance. Throws rather than returning a fallback: an
 * unreadable balance is not a zero balance. */
async function readBalance(
  net: EvmNetwork,
  address: string,
  token: string,
): Promise<number> {
  return evmRpc(net, `balance ${token}`, (provider) =>
    readBalanceWith(net, provider, address, token),
  );
}

// Public RPCs cap the block span of a single eth_getLogs call (commonly a few
// hundred to a few thousand blocks) and reject anything wider outright. Walk
// backwards in chunks that stay under every provider's limit instead of asking
// for the whole window at once.
// Providers cap the eth_getLogs block span differently and change it without
// notice, so the walk starts wide and narrows to whatever limit it is told.
const LOG_CHUNK_BLOCKS = 100;
// Blocks fetched concurrently by the native-transfer scan.
const NATIVE_SCAN_BATCH = 5;
// Alchemy's free tier allows 10; narrowing must be able to reach it.
const MIN_LOG_CHUNK_BLOCKS = 10;
/**
 * Whether the deposit has scrolled out of the native walk's window, making
 * every one of its round trips guaranteed-empty.
 */
function nativeScanIsFutile(
  net: EvmNetwork,
  firstDetectedAt: Date | undefined,
  now: Date = new Date(),
): boolean {
  if (!firstDetectedAt) return false; // Just detected — the walk is worth it.
  const windowMs = net.config.nativeScanBlocks * net.config.searchBlockTimeMs;
  return now.getTime() - firstDetectedAt.getTime() > windowMs;
}
/** Blocks to search back to cover a session of this age, clamped and buffered. */
export function lookbackForAge(
  chain: string,
  createdAt: Date,
  now: Date = new Date(),
): number {
  const ageBlocks = Math.ceil(
    (now.getTime() - createdAt.getTime()) / EVM_CHAINS[chain].searchBlockTimeMs,
  );
  return Math.min(
    EVM_CHAINS[chain].maxLogLookbackBlocks,
    Math.max(LOG_CHUNK_BLOCKS, ageBlocks + 50),
  );
}

/**
 * Whether the deposit predates everything the log walk can reach. It landed
 * before `firstDetectedAt`, so once that is older than the walk's span every
 * chunk is guaranteed-empty — and the walk would repeat on every poll.
 */
export function logScanIsFutile(
  chain: string,
  firstDetectedAt: Date | undefined,
  now: Date = new Date(),
): boolean {
  if (!firstDetectedAt) return false;
  const windowMs =
    EVM_CHAINS[chain].maxLogLookbackBlocks *
    EVM_CHAINS[chain].searchBlockTimeMs;
  return now.getTime() - firstDetectedAt.getTime() > windowMs;
}

/**
 * Block span an endpoint will accept, parsed from its rejection. Providers
 * advertise the cap only by refusing. -1 means "cap unknown, halve and retry".
 */
export function parseRangeLimit(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);

  // "eth_getLogs is limited to 0 - 50 blocks range"  (1rpc)
  const range = msg.match(/limited to\s+\d+\s*-\s*(\d+)\s*blocks?/i);
  if (range) return Math.max(1, parseInt(range[1], 10));

  // "Block range too large: maximum allowed is 50 blocks"  (nodies)
  const maximum = msg.match(/maximum(?:\s+allowed)?\s+is\s+(\d+)\s*blocks?/i);
  if (maximum) return Math.max(1, parseInt(maximum[1], 10));

  // "you can make eth_getLogs requests with up to a 10 block range"  (Alchemy)
  const upTo = msg.match(/up to a?\s*(\d+)\s*block/i);
  if (upTo) return Math.max(1, parseInt(upTo[1], 10));

  // publicnode calls anything past ~100 blocks an archive request. Narrowing
  // genuinely helps, so it must not be left to the refusal path.
  if (/archive requests? require/i.test(msg)) return -1;

  if (
    /too many logs|range is too large|block range too (large|wide)|exceed maximum block range/i.test(
      msg,
    )
  ) {
    return -1; // Cap unknown: halve and retry.
  }
  return null;
}

/**
 * The Transfer log within `lookback` blocks of the head whose value is closest
 * to `received`, in chunks that narrow when the endpoint says the span is too
 * wide. Throws on an outright refusal so the caller can fail over.
 *
 * Closest, not newest: address-poisoning bots answer a real transfer within
 * seconds with zero-value or dust transfers, so "newest" names the attacker's
 * tx — and its lookalike sender, which a merchant may then refund to. The walk
 * stops at the first chunk holding any non-zero candidate: poisoning lands
 * next to the transfer it imitates.
 */
export async function findTransferLog(
  contract: ethers.Contract,
  filter: ethers.ContractEventName,
  latest: number,
  lookback: number,
  decimals: number,
  received: number,
): Promise<ethers.Log | ethers.EventLog | null> {
  const floor = Math.max(0, latest - lookback);
  let chunk = LOG_CHUNK_BLOCKS;
  let to = latest;

  while (to > floor) {
    const from = Math.max(floor, to - chunk + 1);
    try {
      const logs = await contract.queryFilter(filter, from, to);
      const best = closestTransfer(logs, decimals, received);
      if (best) return best;
    } catch (err) {
      const limit = parseRangeLimit(err);
      if (limit !== null && chunk > MIN_LOG_CHUNK_BLOCKS) {
        // Retry the same range narrower; skipping loses any deposit inside.
        chunk =
          limit > 0
            ? Math.max(MIN_LOG_CHUNK_BLOCKS, Math.min(limit, chunk - 1))
            : Math.max(MIN_LOG_CHUNK_BLOCKS, Math.floor(chunk / 2));
        continue;
      }
      if (isEndpointRefusal(err)) throw err; // Let the caller fail over.
      console.warn(`[evm] getLogs ${from}-${to} failed:`, err);
    }
    if (from === floor) break;
    to = from - 1;
  }
  return null;
}

/** Non-zero Transfer log whose value is closest to `received`; newest on ties. */
export function closestTransfer<T extends { data: string }>(
  logs: readonly T[],
  decimals: number,
  received: number,
): T | null {
  let best: T | null = null;
  let bestGap = Infinity;
  // Newest last in queryFilter output; iterate newest-first so ties keep it.
  for (let i = logs.length - 1; i >= 0; i--) {
    let raw: bigint;
    try {
      raw = BigInt(logs[i].data);
    } catch {
      continue; // Not a standard Transfer payload.
    }
    if (raw <= BigInt(0)) continue;
    const gap = Math.abs(
      parseFloat(ethers.formatUnits(raw, decimals)) - received,
    );
    if (gap < bestGap) {
      best = logs[i];
      bestGap = gap;
    }
  }
  return best;
}

function createEvmAdapter(net: EvmNetwork): ChainAdapter {
  const { chain, config } = net;
  return {
    chain,
    supportedTokens: [config.nativeToken, ...Object.keys(config.tokens)].map(
      (t) => t.toUpperCase(),
    ),

    async getBalanceSnapshot(address: string, token: string): Promise<number> {
      return readBalance(net, address, token);
    },

    async checkPayment(
      params: CheckPaymentParams,
    ): Promise<PaymentCheckResult> {
      const {
        address,
        expectedAmount,
        token,
        balanceSnapshot,
        existingTxHash,
        creditedAmount,
        firstDetectedAt,
        createdAt,
        confirmedFrom,
        currentStatus,
      } = params;
      const lowerToken = token.toLowerCase();
      const reqConfs = requiredConfirmations(chain, token);

      // ── Re-confirmation ──
      // Once a deposit is attributed we track it by hash, not by balance. The
      // merchant self-custodies and is free to sweep the wallet at any time,
      // which drives the diff negative — treating that as "no payment" would
      // freeze the session mid-confirmation forever.
      const redetect =
        !!creditedAmount &&
        shouldRedetectUnderpaid(
          currentStatus,
          creditedAmount,
          expectedAmount,
          confirmedFrom,
        );
      if (existingTxHash && !redetect) {
        try {
          const { latest, receipt } = await evmRpc(
            net,
            "re-confirmation",
            async (p) => ({
              latest: await p.getBlockNumber(),
              receipt: await p.getTransactionReceipt(existingTxHash),
            }),
          );
          if (receipt) {
            const confirmations = Math.max(0, latest - receipt.blockNumber);
            // Re-report the amount already credited. Falls back to a fresh diff
            // only when there is no usable credited figure — a zero would
            // otherwise re-classify a real payment as underpaid.
            const credited =
              creditedAmount && creditedAmount > 0
                ? creditedAmount
                : Math.max(
                    0,
                    balanceDelta(
                      await readBalance(net, address, token),
                      balanceSnapshot,
                    ),
                  );
            return {
              detected: true,
              receivedAmount: credited,
              exclusive: true, // already attributed — don't re-run the matcher
              txHash: existingTxHash,
              fromAddress: receipt.from,
              confirmations,
              status:
                confirmations >= reqConfs
                  ? classifyAmount(credited, expectedAmount, confirmedFrom)
                  : "confirming",
            };
          }
        } catch (err) {
          console.warn(`[${chain}] Re-confirmation lookup failed:`, err);
        }
      }

      // 1. Calculate received delta
      // One read per wallet per cycle, shared by every session on it.
      const currentBalance = await cachedRead(
        params.reads,
        `${chain}:balance:${address.toLowerCase()}:${lowerToken}`,
        () => readBalance(net, address, token),
      );
      const received = balanceDelta(currentBalance, balanceSnapshot);

      if (received <= 0) return { detected: false };

      // 2. Determine final status thresholds
      const status = classifyAmount(received, expectedAmount, confirmedFrom);

      // 3. Find transaction hash and confirmations
      let txHash: string | undefined = existingTxHash;
      let fromAddress: string | undefined;
      let confirmations = 0;
      let detectedStatus = "confirming" as PaymentCheckResult["status"];

      try {
        const latest = await cachedRead(params.reads, `${chain}:head`, () =>
          evmRpc(net, "blockNumber", (p) => p.getBlockNumber()),
        );
        const isNative = lowerToken === config.nativeToken;
        if (isNative && nativeScanIsFutile(net, firstDetectedAt)) {
          // Out of window — guaranteed-empty round trips. Skip.
        } else if (isNative) {
          // Native transfers emit no log, so the hash can only be found by
          // walking blocks. No hash is not fatal — confirmationsFromAge settles
          // the session; only the explorer link is lost.
          // Closest value to `received`, not the first hit: as with tokens,
          // dust sends cluster around real ones. An exact match ends the walk.
          const found = await evmRpc(net, "native tx scan", async (p) => {
            const floor = Math.max(0, latest - config.nativeScanBlocks);
            let best: {
              hash: string;
              from: string;
              confirmations: number;
            } | null = null;
            let bestGap = Infinity;
            // Fetched in small parallel batches: one full block per round
            // trip made BSC's 40-block window take several seconds.
            for (let top = latest; top > floor; top -= NATIVE_SCAN_BATCH) {
              const heights: number[] = [];
              for (
                let i = top;
                i > Math.max(floor, top - NATIVE_SCAN_BATCH);
                i--
              ) {
                heights.push(i);
              }
              const blocks = await Promise.all(
                heights.map((h) => p.getBlock(h, true)),
              );
              for (const block of blocks) {
                if (!block) continue;
                // ethers v6: `block.transactions` is always the hash list,
                // even with prefetch requested; the bodies are in
                // `prefetchedTransactions`. Reading `transactions` (as this
                // did) skipped every entry, so no native hash was ever found.
                for (const tx of block.prefetchedTransactions) {
                  if (!tx.to || tx.to.toLowerCase() !== address.toLowerCase()) {
                    continue;
                  }
                  if (tx.value <= BigInt(0)) continue;
                  const gap = Math.abs(
                    balanceDelta(
                      parseFloat(ethers.formatEther(tx.value)),
                      received,
                    ),
                  );
                  if (gap < bestGap) {
                    best = {
                      hash: tx.hash,
                      from: tx.from,
                      confirmations: latest - block.number,
                    };
                    bestGap = gap;
                  }
                }
              }
              if (bestGap === 0) break;
            }
            return best;
          });
          if (found) {
            txHash = found.hash;
            fromAddress = found.from;
            confirmations = found.confirmations;
          }
        } else if (logScanIsFutile(chain, firstDetectedAt)) {
          // Out of reach of the walk — skip its guaranteed-empty round trips.
        } else {
          const contractAddress = config.tokens[lowerToken].contract;
          // One endpoint serves the whole walk; a refusal restarts it on the
          // next rather than returning "no log found".
          const log = await evmRpc(net, "getLogs", async (p) => {
            const contract = new ethers.Contract(contractAddress, ERC20_ABI, p);
            // Walk from THIS endpoint's head. `latest` came from whichever
            // endpoint rotation picked, and a node a few blocks behind it
            // rejects a range ending past its own tip ("invalid block range
            // params") on every chunk of the walk.
            const top = Math.min(latest, await p.getBlockNumber());
            // Cover the session's own age, not a fixed window.
            return findTransferLog(
              contract,
              contract.filters.Transfer(null, address),
              top,
              lookbackForAge(chain, createdAt),
              config.tokens[lowerToken].decimals,
              received,
            );
          });

          if (log) {
            txHash = log.transactionHash;
            // The Transfer event's `from` topic is the true token sender (the tx
            // signer may be a router/contract).
            if (log instanceof ethers.EventLog) {
              fromAddress = log.args?.from as string | undefined;
            }
            const receipt = await evmRpc(net, "getTransactionReceipt", (p) =>
              p.getTransactionReceipt(txHash as string),
            );
            if (receipt) {
              confirmations = latest - receipt.blockNumber;
              fromAddress = fromAddress || receipt.from;
            }
          }
        }
      } catch (err) {
        // Non-fatal: must never fail a detection that already succeeded.
        console.warn(
          `[${chain}] txHash resolution failed:`,
          err instanceof Error ? err.message : err,
        );
      }

      // Age-based floor: a balance delta we have now observed continuously since
      // `firstDetectedAt` has survived that many blocks whether or not we ever
      // resolved a hash for it. Without this, an unresolvable deposit sits at
      // zero confirmations and stays "confirming" for the life of the session.
      confirmations = Math.max(
        confirmations,
        confirmationsFromAge(chain, firstDetectedAt),
      );

      if (confirmations >= reqConfs) {
        detectedStatus = status;
      }

      return {
        detected: true,
        receivedAmount: received,
        currentBalance,
        txHash,
        fromAddress,
        confirmations,
        status: detectedStatus,
      };
    },
  };
}

function evmNetwork(
  chain: string,
  rpcEnv: string,
  defaultUrls: readonly string[],
): EvmNetwork {
  const config = EVM_CHAINS[chain];
  return {
    chain,
    config,
    rpcEnv,
    defaultUrls: defineEndpoints(rpcEnv, defaultUrls),
    network: Network.from(config.chainId),
  };
}

// Probed 2026-09-01. eth.llamarpc.com (Cloudflare 521) and rpc.ankr.com (now
// needs a key) were removed as dead. Measured eth_getLogs span ceilings:
// mevblocker 1000+, publicnode 100, nodies 50, 1rpc 50, drpc none. Requests
// rotate across all of them and the log walk narrows to whatever each allows,
// so no single free quota carries the load. Override with ETH_RPC_URLS.
export const evmAdapter = createEvmAdapter(
  evmNetwork("eth", "ETH_RPC_URLS", [
    "https://rpc.mevblocker.io",
    "https://ethereum.publicnode.com",
    "https://eth-pokt.nodies.app",
    "https://1rpc.io/eth",
    "https://eth.drpc.org",
  ]),
);

// Probed 2026-10-12: publicnode and drpc both serve 100-block eth_getLogs.
// bsc-dataseed*.bnbchain.org / defibit refuse eth_getLogs at every span, and
// a log walk against them fails every chunk, so they are left out even though
// they answer balances. Override with BSC_RPC_URLS.
export const bscAdapter = createEvmAdapter(
  evmNetwork("bsc", "BSC_RPC_URLS", [
    "https://bsc-rpc.publicnode.com",
    "https://bsc.drpc.org",
  ]),
);

// Probed 2026-10-12: quiknode's public endpoint serves 1000+ block getLogs,
// publicnode and drpc 100. polygon-rpc.com now 401s, 1rpc 520s and nodies is
// paid-only. Override with POLYGON_RPC_URLS.
export const polygonAdapter = createEvmAdapter(
  evmNetwork("polygon", "POLYGON_RPC_URLS", [
    "https://rpc-mainnet.matic.quiknode.pro",
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon.drpc.org",
  ]),
);
