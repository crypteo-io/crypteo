import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    merchant: { findUnique: vi.fn() },
    wallet: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit")>()),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/two-factor", () => ({ verifyChallenge: vi.fn() }));
vi.mock("@/lib/mailer", async (orig) => ({
  ...(await orig<typeof import("@/lib/mailer")>()),
  notifyAccountSecurityChange: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notifyAccountSecurityChange } from "@/lib/mailer";
import { verifyChallenge } from "@/lib/two-factor";
import { POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const notify = mock(notifyAccountSecurityChange);
const existing = mock(prisma.wallet.findUnique);
const verify = mock(verifyChallenge);

const ETH = "0x" + "a".repeat(32) + "12345678";
const ETH_OLD = "0x" + "b".repeat(40);

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("https://app.example/api/wallets", {
      method: "POST",
      headers: { "x-real-ip": "203.0.113.5" },
      body: JSON.stringify({ code: "123456", ...body }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(auth).mockResolvedValue({ user: { id: "m1" } });
  mock(prisma.merchant.findUnique).mockResolvedValue({
    id: "m1",
    email: "owner@example.com",
    name: "Owner",
  });
  mock(prisma.wallet.upsert).mockImplementation(async (a) => a.create);
  notify.mockResolvedValue(undefined);
  verify.mockResolvedValue(true);
});

describe("POST /api/wallets verification code", () => {
  it("refuses a new or changed address without a code, before spending one", async () => {
    existing.mockResolvedValue({ address: ETH_OLD, xrpTag: null });
    const res = await post({ chain: "eth", token: "eth", address: ETH, code: undefined });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ codeRequired: true });
    expect(verify).not.toHaveBeenCalled();
    expect(prisma.wallet.upsert).not.toHaveBeenCalled();
  });

  it("refuses a wrong code and saves nothing", async () => {
    existing.mockResolvedValue(null);
    verify.mockResolvedValue(false);
    const res = await post({ chain: "eth", token: "eth", address: ETH });
    expect(res.status).toBe(400);
    expect(verify).toHaveBeenCalledWith("owner@example.com", "123456", "WALLET_CHANGE");
    expect(prisma.wallet.upsert).not.toHaveBeenCalled();
  });

  it("asks for a changed XRP destination tag too", async () => {
    existing.mockResolvedValue({ address: "rDemo", xrpTag: "1" });
    const res = await post({ chain: "xrp", token: "xrp", address: "rDemo", xrpTag: "2", code: undefined });
    expect(res.status).toBe(403);
  });

  it("needs no code to enable or disable the saved address", async () => {
    existing.mockResolvedValue({ address: ETH, xrpTag: null });
    const res = await post({ chain: "eth", token: "eth", address: ETH, isActive: false, code: undefined });
    expect(res.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("POST /api/wallets security notice", () => {
  it("emails the owner when an address is changed, with masked addresses and IP", async () => {
    existing.mockResolvedValue({ address: ETH_OLD, xrpTag: null });
    const res = await post({ chain: "eth", token: "eth", address: ETH });
    expect(res.status).toBe(200);

    const n = notify.mock.calls[0][0];
    expect(n.to).toBe("owner@example.com");
    expect(n.action).toBe("Receiving wallet changed");
    expect(n.ip).toBe("203.0.113.5");
    const text = JSON.stringify(n.details);
    expect(text).toContain("ETH / ETH");
    expect(text).not.toContain(ETH); // masked, never the full address
    expect(text).toContain("5678");
  });

  it("emails on a newly added wallet", async () => {
    existing.mockResolvedValue(null);
    await post({ chain: "eth", token: "eth", address: ETH });
    expect(notify.mock.calls[0][0].action).toBe("Receiving wallet added");
  });

  it("stays quiet on an enable/disable toggle of the same address", async () => {
    existing.mockResolvedValue({ address: ETH, xrpTag: null });
    await post({ chain: "eth", token: "eth", address: ETH, isActive: false });
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not wait on the mail send", async () => {
    existing.mockResolvedValue(null);
    notify.mockReturnValue(new Promise(() => {})); // SMTP hanging forever
    const res = await post({ chain: "eth", token: "eth", address: ETH });
    expect(res.status).toBe(200);
  });
});
