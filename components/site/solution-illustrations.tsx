import { LogoMark } from "@/components/site/Logo";
import type { SolutionKey } from "@/lib/content/solution-links";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  Lock,
  Mail,
  QrCode,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { SOURCE_REPO_URL } from "@/lib/site-links";
import { PlayOnView } from "./PlayOnView";
import { TelegramLogo } from "./solution-icons";

// Page-specific product sketches for the solution pages' showcase section.
// Static sample values (fictional shops, "demo" amounts), hidden from screen
// readers: the copy beside each one says what it shows. Each builds itself up
// from empty when scrolled into view: step(i) marks a piece and its turn.

type StepKind = "rise" | "pop" | "type" | "draw-x" | "draw-y" | "slide" | "fade";

function step(i: number, kind: StepKind = "rise") {
  return { "data-step": kind, style: { "--i": i } as CSSProperties };
}

function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <PlayOnView className="relative isolate">
      <div aria-hidden="true">
        <div {...step(0, "fade")} className="absolute -inset-4 -z-10 rounded-[36px] bg-linear-to-br from-sky-soft/25 via-white to-primary/10 blur-xl" />
        <div className="frame" {...step(0, "fade")}>
          <div className={cn("frame-inner overflow-hidden p-5 md:p-7", className)}>{children}</div>
        </div>
      </div>
    </PlayOnView>
  );
}

function Coin({ src, size = 22 }: { src: string; size?: number }) {
  return <Image src={src} alt="" width={size} height={size} className="shrink-0 rounded-full" />;
}

function WhiteLabel() {
  return (
    <Stage className="bg-default-50/60">
      <div {...step(1)} className="mb-4 flex items-center gap-2 rounded-xl border border-default-200 bg-white px-3 py-2 text-xs text-default-500">
        <Lock size={13} className="text-emerald-600" />
        <span {...step(2, "type")} className="truncate">
          <span className="text-default-900">pay.harborandpine.com</span>/l/winter-candles
        </span>
      </div>
      <div {...step(2)} className="rounded-2xl border border-default-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-default-100 p-4">
          <div className="flex items-center gap-2.5">
            <span {...step(3, "pop")} className="inline-flex size-9 items-center justify-center rounded-lg bg-[#b4532a] font-heading text-sm font-bold text-white">
              H&amp;P
            </span>
            <div>
              <p className="font-heading text-sm font-semibold text-default-950">Harbor &amp; Pine</p>
              <p className="text-xs font-normal text-default-500">Winter candle set</p>
            </div>
          </div>
          <p className="font-heading text-lg font-semibold text-default-950">$64.00</p>
        </div>
        <div className="grid grid-cols-2 gap-2 p-4">
          {[
            { src: "/coins/usdt-icon.png", label: "USDT", net: "on Tron", active: true },
            { src: "/coins/usdc-icon.png", label: "USDC", net: "on Solana" },
            { src: "/coins/bitcoin-icon.png", label: "BTC", net: "on Bitcoin" },
            { src: "/coins/eth-icon.png", label: "ETH", net: "on Ethereum" },
          ].map((c, i) => (
            <div
              key={c.label + c.net}
              {...step(4 + i, "pop")}
              className={cn(
                "flex items-center gap-2 rounded-xl border p-2.5",
                c.active ? "border-[#b4532a] bg-[#b4532a]/5" : "border-default-200",
              )}
            >
              <Coin src={c.src} />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-default-950">{c.label}</p>
                <p className="truncate text-[11px] font-normal text-default-500">{c.net}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 pb-4">
          <div {...step(8)} className="rounded-xl bg-[#b4532a] py-2.5 text-center text-sm font-semibold text-white">Continue to payment</div>
        </div>
        <div {...step(9, "fade")} className="flex flex-wrap items-center justify-between gap-2 border-t border-default-100 px-4 py-3 text-[11px] font-normal text-default-500">
          <span className="inline-flex items-center gap-1.5">
            <Mail size={12} /> hello@harborandpine.com
          </span>
          <span className="inline-flex items-center gap-1">
            Powered by <LogoMark className="size-3" /> Crypteo
          </span>
        </div>
      </div>
    </Stage>
  );
}

const COMPOSE_LINES = [
  { name: "postgres", state: "Healthy" },
  { name: "migrate", state: "Exited (0)" },
  { name: "app", state: "Started" },
  { name: "worker", state: "Started" },
  { name: "nginx", state: "Started" },
  { name: "monitor", state: "Started" },
];

function OpenSource() {
  return (
    <Stage className="bg-default-950 p-0 md:p-0">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 font-mono text-[11px] text-white/40">you@gateway: ~/crypteo</span>
      </div>
      <div className="overflow-x-auto p-5 font-mono text-[12px] leading-relaxed text-default-200 md:p-6 md:text-[13px]">
        <p {...step(1, "type")}>
          <span className="text-sky-soft">$</span> git clone {SOURCE_REPO_URL}
        </p>
        <p {...step(3, "type")}>
          <span className="text-sky-soft">$</span> cp .env.example .env
        </p>
        <p {...step(5, "type")}>
          <span className="text-sky-soft">$</span> docker compose up --build -d
        </p>
        <div className="mt-3 space-y-1">
          {COMPOSE_LINES.map((l, i) => (
            <p key={l.name} {...step(7 + i, "fade")} className="flex justify-between gap-6 whitespace-nowrap">
              <span>
                <span className="text-emerald-300">✔</span> Container crypteo-{l.name}-1
              </span>
              <span className="text-emerald-300">{l.state}</span>
            </p>
          ))}
        </div>
        <p {...step(14, "type")} className="mt-3 text-white/50"># checkout live at https://pay.example.com</p>
      </div>
    </Stage>
  );
}

const EVENTS = [
  { status: "pending", label: "Buyer chose USDC on Polygon", time: "14:02:11" },
  { status: "confirming", label: "Deposit seen on-chain", time: "14:03:40" },
  { status: "confirmed", label: "Confirmations reached, paid: true", time: "14:04:02", done: true },
];

function Api() {
  return (
    <Stage>
      <div {...step(1)} className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-mono text-xs font-semibold text-emerald-700">POST</span>
        <span className="flex-1 truncate font-mono text-xs text-default-500">https://shop.example/hooks/crypteo</span>
        <span {...step(8, "pop")} className="rounded-lg bg-default-100 px-2.5 py-1 font-mono text-xs text-default-700">200 OK</span>
      </div>
      <ol className="relative mb-5 space-y-4 pl-5">
        <span {...step(2, "draw-y")} className="absolute inset-y-0 left-0 w-px bg-default-200" />
        {EVENTS.map((e, i) => (
          <li key={e.status} {...step(3 + i * 2)} className="relative">
            <span
              className={cn(
                "absolute top-1 -left-[27px] inline-flex size-3.5 items-center justify-center rounded-full ring-4 ring-white",
                e.done ? "bg-emerald-500" : "bg-sky",
              )}
            />
            <p className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[13px] font-semibold text-default-950">payment.{e.status}</span>
              <span className="font-mono text-[11px] text-default-400">{e.time}</span>
            </p>
            <p className="text-sm font-normal text-default-600">{e.label}</p>
          </li>
        ))}
      </ol>
      <pre {...step(9)} className="overflow-x-auto rounded-xl bg-default-950 p-4 font-mono text-[12px] leading-relaxed text-default-200">
        <span className="text-white/40">X-Signature: 9f2c…e71a</span>
        {"\n"}
        {"{"} <span className="text-amber-200">&quot;paid&quot;</span>: <span className="text-emerald-300">true</span>,{" "}
        <span className="text-amber-200">&quot;externalId&quot;</span>: <span className="text-emerald-300">&quot;order_1042&quot;</span> {"}"}
      </pre>
    </Stage>
  );
}

function Decentralised() {
  return (
    <Stage className="bg-linear-to-b from-white to-default-50">
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-stretch">
        <Party icon={<ShoppingBag size={20} />} title="Buyer's wallet" note="Sends 120 USDT" turn={1} />
        <div {...step(3)} className="flex flex-col items-center justify-center px-1 text-center">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
            One on-chain transfer
          </span>
          <ArrowRight {...step(4, "slide")} size={22} className="mt-2 hidden text-sky sm:block" />
          <ArrowDown {...step(4)} size={22} className="mt-2 text-sky sm:hidden" />
        </div>
        <Party icon={<Wallet size={20} />} title="Your wallet" note="Receives 120 USDT" highlight turn={5} />
      </div>
      <div {...step(7)} className="mx-auto mt-5 max-w-sm border-t border-dashed border-default-300 pt-5">
        <div className="flex items-center gap-3 rounded-2xl border border-default-200 bg-white p-4">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
            <Eye size={18} />
          </span>
          <div>
            <p className="flex items-center gap-1.5 font-heading text-sm font-semibold text-default-950">
              <LogoMark className="size-3.5" /> Crypteo reads the chain
            </p>
            <p className="text-xs font-normal text-default-500">Matches the deposit to order #2291 and tells you. Holds nothing.</p>
          </div>
        </div>
      </div>
    </Stage>
  );
}

function Party({
  icon,
  title,
  note,
  highlight,
  turn,
}: {
  icon: ReactNode;
  title: string;
  note: string;
  highlight?: boolean;
  turn: number;
}) {
  return (
    <div
      {...step(turn)}
      className={cn(
        "flex w-full flex-1 flex-col items-center rounded-2xl border p-5 text-center",
        highlight ? "border-sky/30 bg-sky/5" : "border-default-200 bg-white",
      )}
    >
      <span {...step(turn + 1, "pop")} className={cn("mb-3 inline-flex size-11 items-center justify-center rounded-xl", highlight ? "bg-sky text-white" : "icon-tile")}>
        {icon}
      </span>
      <p className="font-heading text-sm font-semibold text-default-950">{title}</p>
      <p className="mt-0.5 text-xs font-normal text-default-500">{note}</p>
    </div>
  );
}

function Development() {
  const nodes = [
    { title: "Your server", body: "POST /api/public/v1/payments", tag: "1" },
    { title: "Hosted checkout", body: "Buyer picks a coin and pays", tag: "2" },
    { title: "Your webhook", body: "Signed event, paid: true", tag: "3" },
  ];
  return (
    <Stage>
      <div className="grid gap-3">
        {nodes.map((n, i) => (
          <div key={n.title}>
            <div {...step(1 + i * 2)} className="flex items-center gap-4 rounded-2xl border border-default-200 bg-white p-4">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-primary to-sky font-heading text-sm font-semibold text-white">
                {n.tag}
              </span>
              <div className="min-w-0">
                <p className="font-heading text-sm font-semibold text-default-950">{n.title}</p>
                <p className="truncate font-mono text-xs text-default-500">{n.body}</p>
              </div>
              {i === 2 && <CheckCircle2 {...step(7, "pop")} size={20} className="ml-auto shrink-0 text-emerald-500" />}
            </div>
            {i < nodes.length - 1 && <div {...step(2 + i * 2, "draw-y")} className="mx-auto h-4 w-px bg-default-300" />}
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        {["Store A key", "Store B key", "Client C key"].map((k, i) => (
          <div key={k} {...step(8 + i, "pop")} className="rounded-xl border border-dashed border-default-300 px-2 py-2.5 font-mono text-[11px] text-default-600">
            {k}
          </div>
        ))}
      </div>
    </Stage>
  );
}

const WC_METHODS = [
  { name: "Direct bank transfer", on: false },
  { name: "Crypto payments (Crypteo)", on: true, note: "BTC, ETH, USDT, USDC and more" },
  { name: "Cash on delivery", on: false },
];

function WordPress() {
  return (
    <Stage className="p-0 md:p-0">
      <div {...step(1, "fade")} className="flex items-center gap-2 bg-[#1d2327] px-4 py-2.5 text-xs text-white/80">
        <span className="inline-flex size-5 items-center justify-center rounded-full border border-white/50 font-serif text-[11px] font-bold">W</span>
        WooCommerce <span className="text-white/40">›</span> Settings <span className="text-white/40">›</span> Payments
      </div>
      <ul className="divide-y divide-default-100">
        {WC_METHODS.map((m, i) => (
          <li key={m.name} {...step(2 + i)} className={cn("flex items-center gap-3 px-4 py-3.5 md:px-6", m.on && "bg-[#7f54b3]/5")}>
            <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", m.on ? "bg-[#7f54b3]" : "bg-default-200")}>
              <span
                {...(m.on ? step(6, "slide") : {})}
                className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow", m.on ? "left-4.5" : "left-0.5")}
              />
            </span>
            <div className="min-w-0">
              <p className={cn("text-sm", m.on ? "font-semibold text-default-950" : "font-normal text-default-600")}>{m.name}</p>
              {m.note && <p className="text-xs font-normal text-default-500">{m.note}</p>}
            </div>
          </li>
        ))}
      </ul>
      <div {...step(7)} className="m-4 rounded-2xl border border-default-200 p-4 md:m-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="font-heading text-sm font-semibold text-default-950">Order #1042</p>
          <span {...step(9, "pop")} className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Processing</span>
        </div>
        <p className="flex items-center gap-2 text-xs font-normal text-default-600">
          <Coin src="/coins/bitcoin-icon.png" size={16} /> Paid in BTC, read back from the API before the order moved
        </p>
      </div>
    </Stage>
  );
}

function PaymentLinks() {
  return (
    <Stage className="bg-default-50/60">
      <div className="mx-auto max-w-sm space-y-3">
        <div {...step(1)} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm font-normal text-white">
          Here&apos;s the deposit for the logo work, pay in any coin you like 🙂
        </div>
        <div {...step(3)} className="ml-auto max-w-[85%] overflow-hidden rounded-2xl rounded-br-md border border-default-200 bg-white">
          <div className="flex items-center gap-3 bg-linear-to-br from-primary to-sky p-4 text-white">
            <QrCode size={34} className="shrink-0" />
            <div className="min-w-0">
              <p className="font-heading text-sm font-semibold">Logo design deposit</p>
              <p className="text-xs text-white/75">$250.00 · pay in crypto</p>
            </div>
          </div>
          <p className="truncate px-4 py-2.5 font-mono text-[11px] text-default-500">pay.mira-studio.com/l/logo-deposit</p>
        </div>
        <div {...step(5)} className="max-w-[70%] rounded-2xl rounded-bl-md border border-default-200 bg-white px-4 py-2.5 text-sm font-normal text-default-700">
          Sent, thanks!
        </div>
      </div>
      <div {...step(7, "pop")} className="mx-auto mt-5 flex max-w-sm items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <CheckCircle2 size={18} /> 250 USDC received
        </span>
        <span className="text-xs font-normal text-emerald-700">1 of 1 payments</span>
      </div>
    </Stage>
  );
}

function Telegram() {
  return (
    <Stage className="bg-[#e7eef6] p-0 md:p-0">
      <div {...step(1, "fade")} className="flex items-center gap-3 bg-white px-4 py-3">
        <span {...step(2, "pop")} className="inline-flex size-9 items-center justify-center rounded-full bg-[#2aabee] text-white">
          <TelegramLogo size={18} />
        </span>
        <div>
          <p className="text-sm font-semibold text-default-950">Ridge Coffee Club</p>
          <p className="text-xs font-normal text-default-500">1,284 members</p>
        </div>
      </div>
      <div className="space-y-3 p-4 md:p-6">
        <div {...step(3)} className="ml-auto w-fit rounded-2xl rounded-br-md bg-[#e1fec6] px-3.5 py-2 font-mono text-[13px] text-default-900">
          /pay 25 Ethiopia beans, 1kg
        </div>
        <div {...step(5)} className="max-w-xs">
          <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm">
            <p className="mb-0.5 text-xs font-semibold text-[#2aabee]">Crypteo Pay</p>
            <p className="text-sm font-semibold text-default-950">Ethiopia beans, 1kg</p>
            <p className="text-sm font-normal text-default-600">$25.00, paid in crypto to the club&apos;s wallet</p>
          </div>
          <div {...step(6, "pop")} className="mt-1 rounded-xl bg-white/80 py-2 text-center text-sm font-semibold text-[#2aabee] shadow-sm">Pay $25.00</div>
        </div>
        <div {...step(8, "pop")} className="max-w-xs rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <Check size={16} /> Paid: Ethiopia beans, 1kg
          </p>
          <p className="text-xs font-normal text-default-500">25.00 USDT on Tron</p>
        </div>
      </div>
    </Stage>
  );
}

export const SOLUTION_ILLUSTRATIONS: Record<SolutionKey, () => ReactNode> = {
  whiteLabel: WhiteLabel,
  openSource: OpenSource,
  api: Api,
  decentralised: Decentralised,
  development: Development,
  wordpress: WordPress,
  paymentLinks: PaymentLinks,
  telegram: Telegram,
};
