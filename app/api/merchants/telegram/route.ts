import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { connectLinks, telegramConfigured } from "@/lib/telegram/api";
import { issueConnectCode } from "@/lib/telegram/bot";
import { NextRequest, NextResponse } from "next/server";

/** A fresh one-time code, with the links that carry it to the bot. */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!telegramConfigured()) return NextResponse.json({ error: "Telegram isn't set up on this server." }, { status: 404 });

  const code = await issueConnectCode(session.user.id);
  return NextResponse.json({ code, links: connectLinks(code) });
}
