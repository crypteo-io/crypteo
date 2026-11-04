import crypto from "crypto";

// The Bot API, called only from the server. The token is part of the URL, so
// nothing here logs a URL or passes a fetch error's text along.

const TIMEOUT_MS = 10_000;

export const telegramConfigured = () =>
  !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME && process.env.TELEGRAM_WEBHOOK_SECRET);

export const botUsername = () => process.env.TELEGRAM_BOT_USERNAME ?? "";

/** Constant-time check of the secret Telegram echoes on every update. */
export function isTelegramSecret(received: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !received) return false;
  const digest = (v: string) => crypto.createHash("sha256").update(v).digest();
  return crypto.timingSafeEqual(digest(expected), digest(received));
}

/** Calls a Bot API method. Throws on any refusal, with the method's name and nothing else sensitive. */
export async function callTelegram<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {
    throw new Error(`Telegram ${method}: request failed`);
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!data?.ok) throw new Error(`Telegram ${method}: ${data?.description ?? res.status}`);
  return data.result as T;
}

export interface PayButton {
  label: string;
  url: string;
}

export const sendMessage = (chatId: string, text: string, button?: PayButton) =>
  callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
    ...(button && { reply_markup: { inline_keyboard: [[{ text: button.label, url: button.url }]] } }),
  });

/** Clears a command from a group or channel. Needs admin rights there, so a refusal is fine. */
export const deleteMessage = (chatId: string, messageId: number) =>
  callTelegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => undefined);

/** Links that open the bot, or add it to a group or channel, carrying a connect code. */
export function connectLinks(code: string) {
  const bot = `https://t.me/${botUsername()}`;
  return {
    chat: `${bot}?start=${code}`,
    group: `${bot}?startgroup=${code}&admin=delete_messages`,
    channel: `${bot}?startchannel=${code}&admin=post_messages+delete_messages`,
  };
}
