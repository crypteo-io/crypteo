// What a Telegram message asks the bot to do. Pure, so it is tested on its own.

export const MAX_TITLE = 120;
const DEFAULT_TITLE = "Payment";
const MAX_AMOUNT = 1_000_000;

export interface BotCommand {
  name: string;
  args: string;
}

/** "/pay@crypteo_bot 25 Coffee" → pay, "25 Coffee". Null for text that isn't a command for this bot. */
export function parseCommand(text: string | undefined, bot: string): BotCommand | null {
  const match = text?.trim().match(/^\/([a-z_]+)(?:@([a-z0-9_]+))?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  if (match[2] && match[2].toLowerCase() !== bot.toLowerCase()) return null;
  return { name: match[1].toLowerCase(), args: (match[3] ?? "").trim() };
}

export interface PayRequest {
  amount: number;
  title: string;
}

/** "25.50 Blue hoodie" → the USD price and what it's for. Null when there's no usable price. */
export function parsePayArgs(args: string): PayRequest | null {
  const match = args.match(/^\$?(\d{1,7}(?:\.\d{1,2})?)(?:\s+([\s\S]+))?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!(amount > 0) || amount > MAX_AMOUNT) return null;
  const title = (match[2] ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  return { amount, title: title || DEFAULT_TITLE };
}
