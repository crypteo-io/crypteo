import { flagProbeInput } from "../abuse-signals";
import { paymentLinkUrl, HOST_MERCHANT_SELECT } from "../custom-host";
import { prisma } from "../db";
import { formatAmount } from "../format";
import { offerableWallets } from "../payment/wallets";
import { isOverLimit } from "../rate-limit";
import { HOUR_MS } from "../time";
import crypto from "crypto";
import { z } from "zod";
import { botUsername, callTelegram, deleteMessage, sendMessage } from "./api";
import { parseCommand, parsePayArgs } from "./commands";

// The Telegram bot: a merchant connects a chat with a one-time code from the
// dashboard, then anyone allowed to run that chat posts pay buttons in it. A
// button opens a normal payment link, so everything after the click is the
// same checkout. In a group, only its admins can command the bot.

const CODE_TTL_MS = HOUR_MS / 4;
const LINKS_PER_HOUR = 30;
const ADMIN_STATUSES = ["creator", "administrator"];

const chatSchema = z.object({ id: z.number(), type: z.string(), title: z.string().optional(), first_name: z.string().optional() });
const messageSchema = z.object({
  message_id: z.number(),
  chat: chatSchema,
  from: z.object({ id: z.number() }).optional(),
  sender_chat: z.object({ id: z.number() }).optional(),
  text: z.string().optional(),
});
const updateSchema = z.object({
  message: messageSchema.optional(),
  channel_post: messageSchema.optional(),
  my_chat_member: z
    .object({ chat: chatSchema, new_chat_member: z.object({ status: z.string() }) })
    .optional(),
});
type Message = z.infer<typeof messageSchema>;

const HELP = [
  "Post a payment button in any chat you've connected:",
  "/pay 25 Blue hoodie",
  "",
  "Buyers tap it and pay your own wallet on your checkout.",
  "/disconnect removes this chat. Connect one from Payment links in your Crypteo dashboard.",
].join("\n");

export const hashCode = (code: string) => crypto.createHash("sha256").update(code).digest("hex");

/** A fresh one-time connect code; only its hash is stored. */
export async function issueConnectCode(merchantId: string): Promise<string> {
  const code = crypto.randomBytes(18).toString("base64url");
  await prisma.merchant.update({
    where: { id: merchantId },
    data: { telegramCodeHash: hashCode(code), telegramCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  return code;
}

/**
 * Whether the sender runs this chat. Channel posts need posting rights, a
 * private chat is its owner's, and an anonymous group admin posts as the
 * group itself. An unreadable membership is a no.
 */
async function isChatAdmin(message: Message): Promise<boolean> {
  const { chat, from, sender_chat } = message;
  if (chat.type === "channel" || chat.type === "private") return true;
  if (sender_chat?.id === chat.id) return true;
  if (!from) return false;
  const member = await callTelegram<{ status?: string }>("getChatMember", { chat_id: chat.id, user_id: from.id }).catch(() => null);
  return ADMIN_STATUSES.includes(member?.status ?? "");
}

async function connect(message: Message, code: string): Promise<void> {
  const { chat } = message;
  const chatId = String(chat.id);
  await deleteMessage(chatId, message.message_id);
  if (!(await isChatAdmin(message))) return;

  const merchant = await prisma.merchant.findFirst({
    where: { telegramCodeHash: hashCode(code), telegramCodeExpiresAt: { gt: new Date() }, isActive: true },
    select: { id: true, name: true },
  });
  if (!merchant) {
    await sendMessage(chatId, "That code isn't valid or has expired. Get a new one from Payment links in your dashboard.");
    return;
  }
  const existing = await prisma.telegramChat.findUnique({ where: { chatId } });
  if (existing && existing.merchantId !== merchant.id) {
    await sendMessage(chatId, "This chat is connected to another account. Run /disconnect there first.");
    return;
  }

  // One use: a second message with the same code finds nothing to claim.
  const claimed = await prisma.merchant.updateMany({
    where: { id: merchant.id, telegramCodeHash: hashCode(code) },
    data: { telegramCodeHash: null, telegramCodeExpiresAt: null },
  });
  if (claimed.count === 0) return;

  const title = (chat.title ?? chat.first_name ?? "Private chat").slice(0, 120);
  await prisma.telegramChat.upsert({
    where: { chatId },
    create: { merchantId: merchant.id, chatId, kind: chat.type, title, notifyPaid: chat.type === "private" },
    update: { title, kind: chat.type },
  });
  await sendMessage(chatId, `Connected to ${merchant.name}.\n\n${HELP}`);
}

async function pay(message: Message, args: string): Promise<void> {
  const chatId = String(message.chat.id);
  const request = parsePayArgs(args);
  if (!request) {
    await sendMessage(chatId, "Give a USD price and a title, like: /pay 25 Blue hoodie");
    return;
  }
  const connected = await prisma.telegramChat.findUnique({
    where: { chatId },
    select: {
      merchant: {
        select: {
          ...HOST_MERCHANT_SELECT,
          id: true,
          isActive: true,
          billingHoldAt: true,
          wallets: { where: { isActive: true } },
        },
      },
    },
  });
  if (!connected) {
    await sendMessage(chatId, "This chat isn't connected yet. Connect it from Payment links in your Crypteo dashboard.");
    return;
  }
  const { merchant } = connected;
  if (!merchant.isActive || merchant.billingHoldAt || offerableWallets(merchant.wallets).length === 0) {
    await sendMessage(chatId, "This account can't take payments right now. Check Wallets and Billing in your dashboard.");
    return;
  }
  if (await isOverLimit(`telegram:links:${chatId}`, LINKS_PER_HOUR, HOUR_MS)) {
    await sendMessage(chatId, "That's a lot of payment buttons for one hour. Try again later.");
    return;
  }

  const link = await prisma.paymentLink.create({
    data: { merchantId: merchant.id, title: request.title, amount: request.amount },
  });
  await flagProbeInput(merchant.id, "Payment link (Telegram)", { title: request.title });

  const price = `$${formatAmount(request.amount, "usd")}`;
  await deleteMessage(chatId, message.message_id);
  await sendMessage(chatId, `${request.title}\n${price}`, {
    label: `Pay ${price} with crypto`,
    url: paymentLinkUrl(link.id, merchant),
  });
}

async function handleMessage(message: Message): Promise<void> {
  const command = parseCommand(message.text, botUsername());
  if (!command) return;
  const chatId = String(message.chat.id);

  // Everything but /help changes something, so it is for the chat's admins.
  if (command.name === "help") return void (await sendMessage(chatId, HELP));
  if ((command.name === "start" || command.name === "connect") && command.args) return connect(message, command.args);
  if (command.name === "start") return void (await sendMessage(chatId, HELP));
  if (!(await isChatAdmin(message))) return;

  if (command.name === "pay") return pay(message, command.args);
  if (command.name === "disconnect") {
    const { count } = await prisma.telegramChat.deleteMany({ where: { chatId } });
    await sendMessage(chatId, count ? "Disconnected." : "This chat isn't connected.");
  }
}

/** Handles one update. Anything malformed or not meant for the bot is ignored. */
export async function handleUpdate(raw: unknown): Promise<void> {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return;
  const { message, channel_post, my_chat_member } = parsed.data;

  if (my_chat_member) {
    if (["left", "kicked"].includes(my_chat_member.new_chat_member.status)) {
      await prisma.telegramChat.deleteMany({ where: { chatId: String(my_chat_member.chat.id) } });
    }
    return;
  }
  const post = message ?? channel_post;
  if (post) await handleMessage(post);
}

/** Tells a merchant's opted-in chats a payment is paid. A chat that can't be reached never affects the payment. */
export async function notifyTelegramPaid(merchantId: string, text: string): Promise<void> {
  const logFailure = (err: unknown) => console.error("[telegram] notify failed:", err instanceof Error ? err.message : err);
  try {
    const chats = await prisma.telegramChat.findMany({ where: { merchantId, notifyPaid: true }, select: { chatId: true } });
    await Promise.all(chats.map(({ chatId }) => sendMessage(chatId, text).catch(logFailure)));
  } catch (err) {
    logFailure(err);
  }
}
