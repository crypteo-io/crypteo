import Image from "next/image";

const chainMeta: Record<string, { name: string; image: string }> = {
  eth: { name: "Ethereum", image: "/coins/eth-icon.png" },
  btc: { name: "Bitcoin", image: "/coins/bitcoin-icon.png" },
  sol: { name: "Solana", image: "/coins/solana-icon.png" },
  xrp: { name: "XRP", image: "/coins/xrp-icon.png" },
  // Chains (network picker) and their native tokens (token picker) share
  // icons; both keys are looked up through getChainMeta.
  bsc: { name: "BNB Smart Chain", image: "/coins/bnb-icon.png" },
  bnb: { name: "BNB", image: "/coins/bnb-icon.png" },
  polygon: { name: "Polygon", image: "/coins/polygon-icon.png" },
  pol: { name: "POL", image: "/coins/polygon-icon.png" },
  tron: { name: "Tron", image: "/coins/tron-icon.png" },
  trx: { name: "TRX", image: "/coins/tron-icon.png" },
  doge: { name: "Dogecoin", image: "/coins/doge-icon.png" },
  zec: { name: "Zcash", image: "/coins/zcash-icon.png" },
  ada: { name: "Cardano", image: "/coins/cardano-icon.png" },
  usdc: { name: "USDC", image: "/coins/usdc-icon.png" },
  usdt: { name: "USDT", image: "/coins/usdt-icon.png" },
};

export function getChainMeta(chain?: string | null) {
  if (!chain) {
    return {
      name: "Select Network",
      image: "/coins/eth-icon.png",
    };
  }
  return (
    chainMeta[chain.toLowerCase()] || {
      name: chain,
      image: "/coins/eth-icon.png",
    }
  );
}

export function ChainIcon({
  chain,
  size = 20,
  showName = false,
}: {
  chain?: string | null;
  size?: number;
  showName?: boolean;
}) {
  const meta = getChainMeta(chain);
  return (
    <span className="inline-flex items-center gap-2 shrink-0">
      <Image
        src={meta.image}
        alt={meta.name}
        width={size}
        height={size}
        className="rounded-full object-contain"
      />
      {showName && (
        <span className="text-[14px] font-semibold text-default-700 capitalize">
          {meta.name}
        </span>
      )}
    </span>
  );
}
