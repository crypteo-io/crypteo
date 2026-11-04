/**
 * Points the bot at this server and registers its commands. Safe to re-run.
 *   docker compose exec app npx tsx scripts/telegram-setup.ts
 */
import "dotenv/config";
import { callTelegram, telegramConfigured } from "../lib/telegram/api";

async function main() {
  if (!telegramConfigured() || !process.env.NEXTAUTH_URL) {
    console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET and NEXTAUTH_URL first.");
    process.exit(1);
  }
  await callTelegram("setWebhook", {
    url: `${process.env.NEXTAUTH_URL}/api/telegram/webhook`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "channel_post", "my_chat_member"],
  });
  await callTelegram("setMyCommands", {
    commands: [
      { command: "pay", description: "Post a payment button: /pay 25 Blue hoodie" },
      { command: "reports", description: "Payment reports here: /reports on or /reports off" },
      { command: "disconnect", description: "Disconnect this chat" },
      { command: "help", description: "How the bot works" },
    ],
  });
  console.log("Telegram bot configured.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
