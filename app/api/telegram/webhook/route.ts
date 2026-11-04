import { isTelegramSecret, telegramConfigured } from "@/lib/telegram/api";
import { handleUpdate } from "@/lib/telegram/bot";
import { NextRequest, NextResponse } from "next/server";

/**
 * Telegram's updates, authenticated by the secret set at setWebhook. Always
 * 200 once authenticated: a non-200 makes Telegram redeliver the same update.
 */
export async function POST(req: NextRequest) {
  if (!telegramConfigured()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isTelegramSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  await handleUpdate(update).catch((err) => console.error("[telegram] update failed:", err instanceof Error ? err.message : err));
  return NextResponse.json({ ok: true });
}
