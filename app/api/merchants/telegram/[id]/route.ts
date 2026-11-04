import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { callTelegram } from "@/lib/telegram/api";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const patchSchema = z.object({ notifyPaid: z.boolean() });
type Params = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "Chat not found" }, { status: 404 });

/** Turns paid-payment messages on or off for one chat. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data format" }, { status: 400 });

  const { id } = await params;
  const { count } = await prisma.telegramChat.updateMany({
    where: { id, merchantId: session.user.id },
    data: { notifyPaid: parsed.data.notifyPaid },
  });
  return count ? NextResponse.json({ ok: true }) : notFound();
}

/** Disconnects a chat, and the bot leaves it when it's a group or channel. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const chat = await prisma.telegramChat.findFirst({ where: { id, merchantId: session.user.id } });
  if (!chat) return notFound();
  await prisma.telegramChat.delete({ where: { id: chat.id } });
  if (chat.kind !== "private") await callTelegram("leaveChat", { chat_id: chat.chatId }).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
