import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    paymentLink: { create: vi.fn() },
    wallet: { findUnique: vi.fn() },
    webhookEndpoint: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/security", () => ({ isSafeWebhookUrl: vi.fn(async () => true) }));

import { validateApiKey } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isSafeWebhookUrl } from "@/lib/security";
import { POST } from "./route";

const auth = validateApiKey as unknown as ReturnType<typeof vi.fn>;
const create = prisma.paymentLink.create as unknown as ReturnType<typeof vi.fn>;

const findWallet = prisma.wallet.findUnique as unknown as ReturnType<typeof vi.fn>;

function call(body: Record<string, unknown> = {}) {
  return POST(
    new NextRequest("https://app.example/api/public/v1/payment-links", {
      method: "POST",
      body: JSON.stringify({ title: "T", amount: 10, ...body }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: "l1", title: "T", amount: 10, isActive: true, expiresAt: null });
});

describe("POST /api/public/v1/payment-links", () => {
  it("refuses a test key: links only ever mint live sessions", async () => {
    auth.mockResolvedValue({ merchant: { id: "m1" }, isTest: true });
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/test API key/);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a link with a live key", async () => {
    auth.mockResolvedValue({ merchant: { id: "m1" }, isTest: false });
    const res = await call();
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledOnce();
  });

  // A link pays only into the merchant's saved wallet via resolveAssignment;
  // an address of its own, or a pin on a wallet checkout refuses, must not
  // get through (2026-10-14: a Solana address saved as the XRP wallet).
  describe("wallet pinning can't bypass wallet validation", () => {
    beforeEach(() => auth.mockResolvedValue({ merchant: { id: "m1" }, isTest: false }));

    it("refuses a link carrying its own wallet address", async () => {
      const res = await call({ walletAddress: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", chain: "xrp", token: "xrp" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/walletAddress is not accepted/);
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses a pin on a saved wallet whose address is invalid for the chain", async () => {
      findWallet.mockResolvedValue({ address: "ACTceHEAZYvx4kaukH5aByWo1ckf6Nh9R2iG27XSkN5D", isActive: true });
      const res = await call({ chain: "xrp", token: "xrp" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/not valid on this network/);
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses a pin with no active wallet for the pair", async () => {
      findWallet.mockResolvedValue({ address: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", isActive: false });
      expect((await call({ chain: "xrp", token: "xrp" })).status).toBe(400);
      findWallet.mockResolvedValue(null);
      expect((await call({ chain: "xrp", token: "xrp" })).status).toBe(400);
      expect(create).not.toHaveBeenCalled();
    });

    it("accepts a pin on a valid active wallet and never stores an address", async () => {
      findWallet.mockResolvedValue({ address: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", isActive: true });
      const res = await call({ chain: "XRP", token: "XRP" });
      expect(res.status).toBe(200);
      expect(create.mock.calls[0][0].data).toMatchObject({ chain: "xrp", token: "xrp", walletAddress: null });
    });
  });

  describe("per-link webhook URL", () => {
    beforeEach(() => auth.mockResolvedValue({ merchant: { id: "m1" }, isTest: false }));

    it("stores the link's own webhook URL", async () => {
      const res = await call({ webhookUrl: "https://site-b.example/hook" });
      expect(res.status).toBe(200);
      expect(create.mock.calls[0][0].data.webhookUrl).toBe("https://site-b.example/hook");
    });

    it("refuses a URL that isn't a public address, naming the field", async () => {
      (isSafeWebhookUrl as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      const res = await call({ webhookUrl: "http://10.0.0.5/hook" });
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe("webhookUrl");
      expect(create).not.toHaveBeenCalled();
    });

    it("leaves both empty so payments go to the default endpoint", async () => {
      await call();
      expect(create.mock.calls[0][0].data).toMatchObject({ webhookUrl: null, webhookEndpointId: null });
    });

    it("sends to one of the merchant's own endpoints", async () => {
      (prisma.webhookEndpoint.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ merchantId: "m1" });
      expect((await call({ webhookEndpointId: "eb" })).status).toBe(200);
      expect(create.mock.calls[0][0].data).toMatchObject({ webhookUrl: null, webhookEndpointId: "eb" });
    });

    it("refuses another merchant's endpoint, or both an endpoint and a URL", async () => {
      (prisma.webhookEndpoint.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ merchantId: "other" });
      expect((await call({ webhookEndpointId: "ex" })).status).toBe(400);
      expect((await call({ webhookEndpointId: "eb", webhookUrl: "https://x.example/h" })).status).toBe(400);
      expect(create).not.toHaveBeenCalled();
    });
  });
});
