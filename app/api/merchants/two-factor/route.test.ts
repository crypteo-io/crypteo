import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { merchant: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(), clientIp: () => "203.0.113.5" }));
vi.mock("@/lib/mailer", () => ({ notifyAccountSecurityChange: vi.fn() }));
vi.mock("argon2", () => ({ verify: vi.fn() }));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptSecret, generateTotpSecret, totpCode, totpStepAt } from "@/lib/two-factor";
import { verify } from "argon2";
import { DELETE, GET, POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const req = (method: string, body?: unknown) =>
  new NextRequest("https://app.example/api/merchants/two-factor", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

let secret: string;
const account = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  name: "Shop",
  email: "shop@x.co",
  password: "hash",
  twoFactorMethod: "email",
  totpSecret: null,
  totpPendingSecret: null,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TWO_FACTOR_ENCRYPTION_KEY", "k".repeat(32));
  secret = generateTotpSecret();
  mock(auth).mockResolvedValue({ user: { id: "m1", role: "merchant" } });
  mock(verify).mockResolvedValue(true);
  mock(prisma.merchant.updateMany).mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/merchants/two-factor", () => {
  it("reports the method in use and whether authenticators are offered", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue(account());
    expect(await (await GET(req("GET"))).json()).toEqual({
      method: "email",
      authenticatorAvailable: true,
    });
  });

  it("offers no setup until the encryption key is configured", async () => {
    vi.stubEnv("TWO_FACTOR_ENCRYPTION_KEY", "");
    const res = await POST(req("POST", { action: "setup" }));
    expect(res.status).toBe(503);
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it("stores the setup secret encrypted, as pending only", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue(account());
    const res = await POST(req("POST", { action: "setup" }));
    const { secret: shown } = await res.json();
    const stored = mock(prisma.merchant.update).mock.calls[0][0].data.totpPendingSecret;
    expect(Object.keys(mock(prisma.merchant.update).mock.calls[0][0].data)).toEqual([
      "totpPendingSecret",
    ]);
    expect(stored).not.toContain(shown);
  });

  it("enables only with a valid code from the pending secret and the password", async () => {
    const pending = encryptSecret(secret);
    mock(prisma.merchant.findUnique).mockResolvedValue(account({ totpPendingSecret: pending }));
    const code = totpCode(secret, totpStepAt(Date.now()));

    mock(verify).mockResolvedValue(false);
    expect((await POST(req("POST", { action: "enable", code, password: "x" }))).status).toBe(400);

    mock(verify).mockResolvedValue(true);
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await POST(req("POST", { action: "enable", code: wrong, password: "x" }))).status).toBe(400);
    expect(prisma.merchant.updateMany).not.toHaveBeenCalled();

    const res = await POST(req("POST", { action: "enable", code, password: "x" }));
    expect(res.status).toBe(200);
    expect(prisma.merchant.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", totpPendingSecret: pending },
      data: {
        twoFactorMethod: "totp",
        totpSecret: pending,
        totpPendingSecret: null,
        totpLastUsedStep: totpStepAt(Date.now()),
      },
    });
  });

  it("switches back to email only with the password and a live authenticator code", async () => {
    const active = account({ twoFactorMethod: "totp", totpSecret: encryptSecret(secret), totpLastUsedStep: null });
    mock(prisma.merchant.findUnique).mockResolvedValue(active);

    const wrong = await DELETE(req("DELETE", { code: "000000", password: "x" }));
    const valid = totpCode(secret, totpStepAt(Date.now()));
    if (valid !== "000000") {
      expect(wrong.status).toBe(400);
      expect(prisma.merchant.update).not.toHaveBeenCalled();
    }

    const res = await DELETE(req("DELETE", { code: valid, password: "x" }));
    expect(res.status).toBe(200);
    expect(prisma.merchant.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: {
        twoFactorMethod: "email",
        totpSecret: null,
        totpPendingSecret: null,
        totpLastUsedStep: null,
      },
    });
  });
});
