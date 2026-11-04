import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleUpdate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/telegram/bot", () => ({ handleUpdate }));

import { POST } from "./route";

const post = (secret?: string, body = "{}") =>
  POST(
    new NextRequest("https://crypteo.io/api/telegram/webhook", {
      method: "POST",
      body,
      headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
    }),
  );

describe("POST /api/telegram/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleUpdate.mockResolvedValue(undefined);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "crypteo_bot");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "secret");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a wrong or missing secret", async () => {
    expect((await post("nope")).status).toBe(401);
    expect((await post()).status).toBe(401);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("is off without a bot", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect((await post("secret")).status).toBe(404);
  });

  it("answers 200 even when handling fails or the body is bad, so Telegram doesn't redeliver", async () => {
    handleUpdate.mockRejectedValue(new Error("db down"));
    expect((await post("secret")).status).toBe(200);
    expect((await post("secret", "not json")).status).toBe(200);
  });
});
