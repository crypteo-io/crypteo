import { cn } from "@/lib/utils";
import { ChevronDown, ShieldCheck } from "lucide-react";

const TITLE = "Tip: Receive into a self-custody wallet";

/**
 * Merchants receive straight into their own addresses. An exchange deposit
 * address is shared and the exchange decides how (and whether) to credit it,
 * and its own XRP tag or Solana memo collides with the per-session ones.
 */
function TipBody() {
  return (
    <p className="text-[13px] leading-relaxed text-default-600">
      We recommend a wallet you hold the keys to, like <strong className="font-semibold text-default-900">Base Wallet</strong>{" "}
      or <strong className="font-semibold text-default-900">Trust Wallet</strong>, rather than an exchange deposit address.
      Exchanges can hold a deposit, ask you to explain a transfer or ask for KYC before crediting it.
    </p>
  );
}

export function SelfCustodyTip({ collapsible = false, defaultOpen = true }: { collapsible?: boolean; defaultOpen?: boolean }) {
  const box = "rounded-xl border border-sky/15 bg-sky/5 text-left";
  const icon = <ShieldCheck size={18} className="shrink-0 text-sky" />;
  if (!collapsible) {
    return (
      <div role="note" className={cn(box, "flex items-start gap-3 p-4")}>
        <span className="mt-0.5">{icon}</span>
        <div>
          <p className="mb-1 text-[13px] font-bold text-default-950">{TITLE}</p>
          <TipBody />
        </div>
      </div>
    );
  }
  return (
    <details open={defaultOpen} className={cn(box, "group")}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        {icon}
        <span className="text-[13px] font-bold text-default-950">{TITLE}</span>
        <ChevronDown size={16} className="ml-auto text-default-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="-mt-1 px-4 pb-4 pl-[46px]">
        <TipBody />
      </div>
    </details>
  );
}
