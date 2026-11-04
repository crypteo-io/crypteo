// Every receiving address a merchant can set, in the order the Wallets page
// and checkout list them (user, 2026-11-02): one asset's networks stay
// together. Client-safe: no chain or database imports.

export interface WalletSlot {
  chain: string;
  token: string;
  /** The network, under the asset's heading. */
  network: string;
  placeholder?: string;
}

export interface WalletAsset {
  id: string;
  name: string;
  /** ChainIcon key. */
  icon: string;
  slots: WalletSlot[];
}

const native = (id: string, name: string, chain: string, token: string, placeholder?: string): WalletAsset => ({
  id,
  name,
  icon: id,
  slots: [{ chain, token, network: name, placeholder }],
});

export const WALLET_ASSETS: WalletAsset[] = [
  native("eth", "Ethereum", "eth", "eth"),
  native("btc", "Bitcoin", "btc", "btc"),
  {
    id: "usdc",
    name: "USDC",
    icon: "usdc",
    slots: [
      { chain: "eth", token: "usdc", network: "Ethereum (ERC-20)" },
      { chain: "sol", token: "usdc", network: "Solana (SPL)" },
      { chain: "bsc", token: "usdc", network: "BNB Smart Chain (BEP-20)" },
      { chain: "polygon", token: "usdc", network: "Polygon" },
    ],
  },
  {
    id: "usdt",
    name: "USDT",
    icon: "usdt",
    slots: [
      { chain: "eth", token: "usdt", network: "Ethereum (ERC-20)" },
      { chain: "sol", token: "usdt", network: "Solana (SPL)" },
      { chain: "bsc", token: "usdt", network: "BNB Smart Chain (BEP-20)" },
      { chain: "polygon", token: "usdt", network: "Polygon" },
      { chain: "tron", token: "usdt", network: "Tron (TRC-20)" },
    ],
  },
  native("sol", "Solana", "sol", "sol"),
  native("bnb", "BNB Smart Chain", "bsc", "bnb"),
  native("polygon", "Polygon", "polygon", "pol"),
  native("tron", "Tron", "tron", "trx"),
  native("xrp", "XRP", "xrp", "xrp"),
  native("doge", "Dogecoin", "doge", "doge"),
  native("zec", "Zcash", "zec", "zec", "Transparent t1… or t3… address"),
  native("ada", "Cardano", "ada", "ada", "addr1…"),
];

export const slotKey = (chain: string, token: string) => `${chain.toLowerCase()}-${token.toLowerCase()}`;

const RANK = new Map(WALLET_ASSETS.flatMap((a) => a.slots).map((s, i) => [slotKey(s.chain, s.token), i]));

/** "USDC" and "Solana (SPL)" for a pair, for lists outside the Wallets page. */
export function slotLabel(chain: string, token: string): { asset: string; network: string } {
  const key = slotKey(chain, token);
  for (const asset of WALLET_ASSETS) {
    const slot = asset.slots.find((s) => slotKey(s.chain, s.token) === key);
    if (slot) return { asset: asset.name, network: slot.network };
  }
  return { asset: token.toUpperCase(), network: chain.toUpperCase() };
}

/** Sorts chain/token pairs into the Wallets page order; unknown pairs go last. */
export function byWalletOrder<T extends { chain: string; token: string }>(pairs: readonly T[]): T[] {
  const rank = (p: T) => RANK.get(slotKey(p.chain, p.token)) ?? RANK.size;
  return [...pairs].sort((a, b) => rank(a) - rank(b));
}
