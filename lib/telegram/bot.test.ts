import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  merchant: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  telegramChat: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  paymentLink: { create: vi.fn() },
}));
const tg = vi.hoisted(() => ({ callTelegram: vi.fn(), sendMessage: vi.fn(), deleteMessage: vi.fn(), botUsername: () => "crypteo_bot" }));
const limits = vi.hoisted(() => ({ isOverLimit: vi.fn() }));

vi.mock("../db", () => ({ prisma: db }));
vi.mock("./api", () => tg);
vi.mock("../rate-limit", () => limits);
vi.mock("../abuse-signals", () => ({ flagProbeInput: vi.fn() }));

import { handleUpdate, hashCode, notifyTelegramPaid } from "./bot";

const WALLET = { chain: "eth", token: "usdc", address: "0x52908400098527886E0F7030069857D2E4169EE7", isActive: true };
const group = { id: -100, type: "supergroup", title: "Shop" };
const message = (text: string, chat: Record<string, unknown> = group, extra: Record<string, unknown> = {}) => ({
  message: { message_id: 7, chat, from: { id: 42 }, text, ...extra },
});
const connectedMerchant = (over: Record<string, unknown> = {}) => ({
  merchant: { id: "m1", isActive: true, billingHoldAt: null, customDomain: null, customDomainVerifiedAt: null, wallets: [WALLET], ...over },
});
const member = (status: string) => tg.callTelegram.mockResolvedValue({ status });

beforeEach(() => {
  vi.clearAllMocks();
  tg.sendMessage.mockResolvedValue(undefined);
  limits.isOverLimit.mockResolvedValue(false);
  db.merchant.updateMany.mockResolvedValue({ count: 1 });
  db.paymentLink.create.mockResolvedValue({ id: "link1" });
  db.telegramChat.findUnique.mockResolvedValue(null);
});

describe("connecting a chat", () => {
  const code = "abc123";
  beforeEach(() => db.merchant.findFirst.mockResolvedValue({ id: "m1", name: "Larkspur" }));

  it("connects with a valid code and spends it", async () => {
    member("administrator");
    await handleUpdate(message(`/start@crypteo_bot ${code}`));
    expect(db.merchant.findFirst.mock.calls[0][0].where.telegramCodeHash).toBe(hashCode(code));
    expect(db.merchant.updateMany.mock.calls[0][0].data).toEqual({ telegramCodeHash: null, telegramCodeExpiresAt: null });
    expect(db.telegramChat.upsert.mock.calls[0][0].create).toMatchObject({ merchantId: "m1", chatId: "-100", notifyPaid: false });
  });

  it("removes the code from the chat before anything else", async () => {
    member("member");
    await handleUpdate(message(`/connect ${code}`));
    expect(tg.deleteMessage).toHaveBeenCalledWith("-100", 7);
  });

  it("refuses a group member who isn't an admin", async () => {
    member("member");
    await handleUpdate(message(`/connect ${code}`));
    expect(db.telegramChat.upsert).not.toHaveBeenCalled();
  });

  it("treats an unreadable membership as not an admin", async () => {
    tg.callTelegram.mockRejectedValue(new Error("down"));
    await handleUpdate(message(`/connect ${code}`));
    expect(db.telegramChat.upsert).not.toHaveBeenCalled();
  });

  it("accepts an anonymous admin, who posts as the group", async () => {
    await handleUpdate(message(`/connect ${code}`, group, { from: { id: 1087968824 }, sender_chat: { id: -100 } }));
    expect(db.telegramChat.upsert).toHaveBeenCalled();
  });

  it("won't take a chat connected to another account", async () => {
    member("creator");
    db.telegramChat.findUnique.mockResolvedValue({ merchantId: "m2" });
    await handleUpdate(message(`/connect ${code}`));
    expect(db.merchant.updateMany).not.toHaveBeenCalled();
    expect(db.telegramChat.upsert).not.toHaveBeenCalled();
  });

  it("stops at a code another message already spent", async () => {
    member("creator");
    db.merchant.updateMany.mockResolvedValue({ count: 0 });
    await handleUpdate(message(`/connect ${code}`));
    expect(db.telegramChat.upsert).not.toHaveBeenCalled();
  });

  it("turns paid messages on only for a private chat", async () => {
    await handleUpdate(message(`/start ${code}`, { id: 5, type: "private", first_name: "Ada" }));
    expect(db.telegramChat.upsert.mock.calls[0][0].create).toMatchObject({ kind: "private", notifyPaid: true });
  });
});

describe("/pay", () => {
  beforeEach(() => db.telegramChat.findUnique.mockResolvedValue(connectedMerchant()));

  it("posts a button to a new payment link and clears the command", async () => {
    member("administrator");
    await handleUpdate(message("/pay 25 Blue hoodie"));
    expect(db.paymentLink.create.mock.calls[0][0].data).toEqual({ merchantId: "m1", title: "Blue hoodie", amount: 25 });
    expect(tg.deleteMessage).toHaveBeenCalledWith("-100", 7);
    const [chat, text, button] = tg.sendMessage.mock.calls[0];
    expect(chat).toBe("-100");
    expect(text).toContain("Blue hoodie");
    expect(button.url).toMatch(/\/pay\/link1$/);
  });

  it("works from a channel post", async () => {
    await handleUpdate({ channel_post: { message_id: 1, chat: { id: -200, type: "channel", title: "News" }, text: "/pay 5" } });
    expect(db.paymentLink.create).toHaveBeenCalled();
  });

  it("uses the merchant's verified domain", async () => {
    member("creator");
    db.telegramChat.findUnique.mockResolvedValue(connectedMerchant({ customDomain: "pay.shop.com", customDomainVerifiedAt: new Date() }));
    await handleUpdate(message("/pay 5"));
    expect(tg.sendMessage.mock.calls[0][2].url).toBe("https://pay.shop.com/pay/link1");
  });

  it("ignores a group member who isn't an admin", async () => {
    member("member");
    await handleUpdate(message("/pay 25"));
    expect(db.paymentLink.create).not.toHaveBeenCalled();
    expect(tg.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["suspended", { isActive: false }],
    ["on billing hold", { billingHoldAt: new Date() }],
    ["without a wallet", { wallets: [] }],
  ])("creates no link for an account %s", async (_, over) => {
    member("creator");
    db.telegramChat.findUnique.mockResolvedValue(connectedMerchant(over));
    await handleUpdate(message("/pay 25"));
    expect(db.paymentLink.create).not.toHaveBeenCalled();
  });

  it("creates no link in a chat that isn't connected", async () => {
    member("creator");
    db.telegramChat.findUnique.mockResolvedValue(null);
    await handleUpdate(message("/pay 25"));
    expect(db.paymentLink.create).not.toHaveBeenCalled();
  });

  it("creates no link over the hourly limit", async () => {
    member("creator");
    limits.isOverLimit.mockResolvedValue(true);
    await handleUpdate(message("/pay 25"));
    expect(db.paymentLink.create).not.toHaveBeenCalled();
  });
});

describe("/reports", () => {
  it("lets an admin switch reports for this chat", async () => {
    member("administrator");
    db.telegramChat.findUnique.mockResolvedValue({ notifyPaid: true });
    await handleUpdate(message("/reports off"));
    expect(db.telegramChat.update).toHaveBeenCalledWith({ where: { chatId: "-100" }, data: { notifyPaid: false } });
  });

  it("says which it is without an argument, and changes nothing", async () => {
    db.telegramChat.findUnique.mockResolvedValue({ notifyPaid: false });
    await handleUpdate(message("/reports", { id: 5, type: "private" }));
    expect(db.telegramChat.update).not.toHaveBeenCalled();
    expect(tg.sendMessage.mock.calls[0][1]).toContain("off");
  });

  it("ignores a group member who isn't an admin", async () => {
    member("member");
    await handleUpdate(message("/reports on"));
    expect(db.telegramChat.update).not.toHaveBeenCalled();
    expect(tg.sendMessage).not.toHaveBeenCalled();
  });

  it("changes nothing in a chat that isn't connected", async () => {
    member("creator");
    await handleUpdate(message("/reports on"));
    expect(db.telegramChat.update).not.toHaveBeenCalled();
  });
});

describe("the rest of the bot", () => {
  it("forgets a chat the bot was removed from", async () => {
    await handleUpdate({ my_chat_member: { chat: group, new_chat_member: { status: "kicked" } } });
    expect(db.telegramChat.deleteMany).toHaveBeenCalledWith({ where: { chatId: "-100" } });
  });

  it("only lets an admin disconnect a group", async () => {
    member("member");
    await handleUpdate(message("/disconnect"));
    expect(db.telegramChat.deleteMany).not.toHaveBeenCalled();
  });

  it("ignores malformed updates", async () => {
    await expect(handleUpdate({ message: { chat: "x" } })).resolves.toBeUndefined();
    await expect(handleUpdate(null)).resolves.toBeUndefined();
    expect(tg.sendMessage).not.toHaveBeenCalled();
  });

  it("a chat that can't be reached doesn't stop the others", async () => {
    db.telegramChat.findMany.mockResolvedValue([{ chatId: "1" }, { chatId: "2" }]);
    tg.sendMessage.mockRejectedValueOnce(new Error("blocked"));
    await expect(notifyTelegramPaid("m1", "Paid")).resolves.toBeUndefined();
    expect(tg.sendMessage).toHaveBeenCalledTimes(2);
  });
});
