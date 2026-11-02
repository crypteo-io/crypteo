import { LogoMark } from "@/components/site/Logo";
import { CheckCircle2, LayoutGrid, Link2, ListChecks, ShoppingBag, Wallet } from "lucide-react";
import Image from "next/image";

// Illustrative product preview for the hero. Static demo values, not live data.

const ROWS = [
  { coin: "usdc", label: "USDC · Solana", amount: "249.00", status: "Confirmed" },
  { coin: "bitcoin", label: "BTC · Bitcoin", amount: "1,180.00", status: "Confirming" },
  { coin: "usdt", label: "USDT · Tron", amount: "89.90", status: "Confirmed" },
  { coin: "eth", label: "ETH · Ethereum", amount: "420.00", status: "Confirmed" },
];

const STATUS = {
  Confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Confirming: "bg-sky/5 text-sky border-sky/20",
} as const;

export default function HeroPreview() {
  return (
    <div aria-hidden="true" className="relative mx-auto mt-14 w-full max-w-5xl md:mt-20 [perspective:2000px]">
      <div className="rounded-[28px] border border-white/40 bg-white/25 p-2.5 shadow-[0_30px_80px_-20px_rgba(6,15,22,0.25)] backdrop-blur-sm md:[transform:rotateX(14deg)] origin-bottom">
        <div className="flex overflow-hidden rounded-[20px] border border-default-100 bg-white text-left">
          <aside className="hidden w-48 shrink-0 border-r border-default-100 bg-default-50/60 p-4 md:block">
            <div className="mb-6 flex items-center gap-2">
              <LogoMark className="size-6" />
              <span className="font-heading text-base font-semibold text-default-950">Crypteo</span>
            </div>
            {[
              { icon: LayoutGrid, label: "Overview", active: true },
              { icon: ListChecks, label: "Payments" },
              { icon: Link2, label: "Payment links" },
              { icon: Wallet, label: "Wallets" },
            ].map(({ icon: Icon, label, active }) => (
              <div
                key={label}
                className={`mb-1 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${
                  active ? "bg-primary text-white" : "text-default-600"
                }`}
              >
                <Icon size={15} />
                {label}
              </div>
            ))}
          </aside>

          <div className="min-w-0 flex-1 p-4 md:p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-default-500">Good morning</p>
                <p className="font-heading text-lg font-semibold text-default-950">Larkspur Goods</p>
              </div>
              <span className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white">
                + Payment link
              </span>
            </div>

            <div className="mb-5 grid grid-cols-3 gap-2.5 md:gap-4">
              {[
                { label: "Volume (24h)", value: "$12,480" },
                { label: "Payments", value: "64" },
                { label: "Settled to wallet", value: "100%" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-default-100 bg-default-50/60 p-3 md:p-4">
                  <p className="text-[11px] text-default-500 md:text-xs">{s.label}</p>
                  <p className="mt-1 font-heading text-lg font-semibold text-default-950 md:text-2xl">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-default-100">
              {ROWS.map((r, i) => (
                <div
                  key={r.label}
                  className={`flex items-center gap-3 px-3 py-2.5 text-[13px] md:px-4 ${
                    i > 0 ? "border-t border-default-100" : ""
                  }`}
                >
                  <Image src={`/coins/${r.coin}-icon.png`} alt="" width={22} height={22} className="rounded-full" />
                  <span className="min-w-0 flex-1 truncate text-default-700">{r.label}</span>
                  <span className="font-semibold text-default-950">${r.amount}</span>
                  <span
                    className={`hidden rounded-md border px-2 py-0.5 text-[11px] font-medium sm:inline-block ${
                      STATUS[r.status as keyof typeof STATUS]
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="animate-float absolute -right-2 -bottom-8 hidden w-64 rounded-2xl border border-default-100 bg-white p-4 text-left shadow-[0_20px_50px_-12px_rgba(6,15,22,0.25)] lg:block">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 size={20} className="text-emerald-600" />
          <p className="font-heading text-sm font-semibold text-default-950">Payment confirmed</p>
        </div>
        <p className="mt-2 text-xs text-default-500">249.00 USDC received in</p>
        <p className="mt-0.5 font-mono text-xs text-default-800">your wallet · 7xKX…3fQ9</p>
      </div>
      <div className="animate-float absolute -left-3 top-10 hidden items-center gap-2 rounded-xl border border-default-100 bg-white px-3.5 py-2.5 text-xs font-medium text-default-800 shadow-[0_20px_50px_-12px_rgba(6,15,22,0.2)] [animation-delay:-3s] lg:flex">
        <ShoppingBag size={15} className="text-sky" />
        Order #1043 paid · 89.90 USDT
      </div>
    </div>
  );
}
