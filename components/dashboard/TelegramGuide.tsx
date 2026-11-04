"use client";

import { parsePayArgs, payPrice } from "@/lib/telegram/commands";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, Bell, BellOff, Check, ChevronDown, CircleHelp, CreditCard, Megaphone, MessageCircle, Send, Users, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

type Place = "private" | "group" | "channel";

const PLACES: { id: Place; label: string; icon: LucideIcon; use: string; add: string }[] = [
  {
    id: "private",
    label: "Private chat",
    icon: MessageCircle,
    use: "Best for one-to-one sales and for getting your paid messages.",
    add: "Choose Open a private chat, then press Start in Telegram. The bot confirms straight away.",
  },
  {
    id: "group",
    label: "Group",
    icon: Users,
    use: "Best for a community. Only the group's admins can post buttons.",
    add: "Choose Add to a group, pick the group and accept the admin rights, so the bot can remove your commands.",
  },
  {
    id: "channel",
    label: "Channel",
    icon: Megaphone,
    use: "Best for announcing a product to your followers.",
    add: "Choose Add to a channel and make the bot an admin. Then post the /connect message from this card. The bot removes it.",
  },
];

const STEPS = ["Pick a place", "Add the bot", "Post a button", "Buyers pay", "Get reports"];

function Chat({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-default-200 bg-white">
      <p className="flex items-center gap-2 border-b border-default-100 px-3 py-2 text-[12px] font-semibold text-default-700">
        <Send size={13} className="text-sky" aria-hidden /> {title}
      </p>
      <div className="min-h-32 space-y-2 bg-sky/5 p-3">{children}</div>
    </div>
  );
}

const Bubble = ({ mine, children }: { mine?: boolean; children: ReactNode }) => (
  <p
    className={cn(
      "w-fit max-w-[90%] whitespace-pre-line rounded-xl px-3 py-2 text-[13px] [overflow-wrap:anywhere]",
      mine ? "ml-auto bg-primary text-white" : "bg-white text-default-800 shadow-sm",
    )}
  >
    {children}
  </p>
);

const CHAT_TITLE: Record<Place, string> = { private: "Crypteo bot", group: "Your group", channel: "Your channel" };

/** Lets a merchant type a command and see the button it would post. Nothing is sent. */
function PayPreview({ place }: { place: Place }) {
  const [command, setCommand] = useState("25 Blue hoodie");
  const request = parsePayArgs(command.trim());
  const price = request ? payPrice(request.amount) : "";
  return (
    <div className="space-y-3">
      <label className="block text-[13px] font-medium text-default-700">
        Try it: price, then a title
        <span className="mt-1 flex items-center gap-2 rounded-lg border border-default-200 bg-white px-3 focus-within:border-primary">
          <code className="text-[13px] text-default-500">/pay</code>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-2 font-mono text-[13px] text-default-950 outline-none"
          />
        </span>
      </label>
      <Chat title={CHAT_TITLE[place]}>
        {request ? (
          <>
            <Bubble>{`${request.title}\n${price}`}</Bubble>
            <p className="w-fit rounded-lg bg-primary/10 px-3 py-1.5 text-[13px] font-medium text-primary">Pay {price} with crypto</p>
          </>
        ) : (
          <p className="text-[13px] text-default-600">Start with a USD price, like 25 or 25.50.</p>
        )}
      </Chat>
    </div>
  );
}

/** The Reports switch as a try-out: nothing is saved. */
function ReportsPreview() {
  const [on, setOn] = useState(true);
  return (
    <div className="space-y-3">
      <p>
        The bot can tell a chat about every paid payment on your account, including ones from your store or the API. Each connected
        chat has its own Reports switch, or use /reports on and /reports off in Telegram. Reports start on for private chats and off for
        groups and channels, because anyone in those can read them.
      </p>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => setOn(!on)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
          on ? "border-primary bg-primary text-white" : "border-default-200 bg-white text-default-800",
        )}
      >
        {on ? <Bell size={16} aria-hidden /> : <BellOff size={16} aria-hidden />} Reports {on ? "on" : "off"}
      </button>
      <Chat title={CHAT_TITLE.private}>
        {on ? <Bubble>Payment received: 25 USDT</Bubble> : <p className="text-[13px] text-default-600">Nothing is posted in this chat when a payment is paid.</p>}
      </Chat>
    </div>
  );
}

function StepBody({ step, place, setPlace }: { step: number; place: Place; setPlace: (p: Place) => void }) {
  const current = PLACES.find((p) => p.id === place) ?? PLACES[0];
  switch (step) {
    case 0:
      return (
        <div className="space-y-3">
          <p>Where will you sell? Pick one to see how it works. You can connect as many as you like.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {PLACES.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={p.id === place}
                onClick={() => setPlace(p.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left font-medium transition-colors",
                  p.id === place ? "border-primary bg-primary text-white" : "border-default-200 bg-white text-default-800 hover:border-default-300",
                )}
              >
                <p.icon size={16} aria-hidden /> {p.label}
              </button>
            ))}
          </div>
          <p className="text-default-600">{current.use}</p>
        </div>
      );
    case 1:
      return (
        <div className="space-y-3">
          <p>Press Connect a chat above for a one-time code. It lasts 15 minutes. {current.add}</p>
          <Chat title={CHAT_TITLE[place]}>
            {place === "channel" && <Bubble mine>/connect your-code</Bubble>}
            <Bubble>Connected to your account.</Bubble>
          </Chat>
        </div>
      );
    case 2:
      return <PayPreview place={place} />;
    case 3:
      return (
        <div className="space-y-3">
          <p>The button opens your normal checkout, with your branding and your domain if you&apos;ve connected one. Buyers pick a coin and pay your wallet directly.</p>
          <div className="flex items-center gap-3 rounded-xl border border-default-200 bg-white p-3">
            <span className="icon-tile size-9 shrink-0">
              <CreditCard size={16} />
            </span>
            <p className="text-default-600">Every button is a payment link, so you&apos;ll find it under Payment links, where you can turn it off.</p>
          </div>
        </div>
      );
    default:
      return <ReportsPreview />;
  }
}

/** "How it works" in the Telegram card: open until the merchant has connected a chat. */
export function TelegramGuide({ defaultOpen }: { defaultOpen: boolean }) {
  const [step, setStep] = useState(0);
  const [place, setPlace] = useState<Place>("group");
  const last = STEPS.length - 1;
  const stripRef = useRef<HTMLOListElement>(null);

  // On a phone the steps scroll sideways: keep the current one in view.
  useEffect(() => {
    const strip = stripRef.current;
    const current = strip?.querySelector<HTMLElement>('[aria-current="step"]');
    if (strip && current) strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
  }, [step]);

  return (
    <details open={defaultOpen} className="group/guide mt-4 rounded-xl border border-default-100 bg-default-50">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-[14px] font-semibold text-default-950 [&::-webkit-details-marker]:hidden">
        <CircleHelp size={16} className="text-sky" aria-hidden /> How it works
        <ChevronDown size={16} className="ml-auto text-default-500 transition-transform group-open/guide:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-4">
        <ol ref={stripRef} className="relative mb-4 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {STEPS.map((label, i) => (
            <li key={label} className="shrink-0">
              <button
                type="button"
                aria-current={i === step ? "step" : undefined}
                onClick={() => setStep(i)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                  i === step ? "bg-white text-default-950 shadow-sm" : "text-default-600 hover:bg-white/60",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                    i <= step ? "bg-primary text-white" : "bg-default-200 text-default-600",
                  )}
                >
                  {i < step ? <Check size={12} aria-hidden /> : i + 1}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        <div aria-live="polite" className="text-[14px] text-default-800">
          <h3 className="mb-2 font-heading text-[15px] font-semibold text-default-950">{STEPS[step]}</h3>
          <StepBody step={step} place={place} setPlace={setPlace} />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
            className="flex items-center gap-1 text-[13px] font-medium text-default-600 hover:text-default-950 disabled:invisible"
          >
            <ArrowLeft size={14} aria-hidden /> Back
          </button>
          <button
            type="button"
            onClick={() => setStep(step === last ? 0 : step + 1)}
            className="flex items-center gap-1 text-[13px] font-semibold text-primary hover:text-primary-deep"
          >
            {step === last ? "Start over" : "Next"} <ArrowRight size={14} aria-hidden />
          </button>
        </div>
      </div>
    </details>
  );
}
