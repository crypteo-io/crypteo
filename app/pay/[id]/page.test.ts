import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    paymentLink: { findUnique: vi.fn() },
    payment: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit")>()),
  isRateLimitedByHeaders: vi.fn(),
}));
vi.mock("@/lib/security", () => ({ isBotUserAgent: vi.fn(() => false) }));
vi.mock("@/lib/payment/assign", () => ({
  ORIGINAL_USD_KEY: "originalUsdAmount",
  resolveAssignment: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { resolveAssignment } from "@/lib/payment/assign";
import { isRateLimitedByHeaders } from "@/lib/rate-limit";
import { headers } from "next/headers";
import PayLinkRedirect from "./page";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const linkFind = mock(prisma.paymentLink.findUnique);
const findFirst = mock(prisma.payment.findFirst);
const create = mock(prisma.payment.create);
const limited = mock(isRateLimitedByHeaders);

function hdrs(ip = "203.0.113.5", ua = "Mozilla/5.0 Test") {
  return new Headers({ "x-real-ip": ip, "user-agent": ua });
}

function open() {
  return PayLinkRedirect({ params: Promise.resolve({ id: "link1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_SECRET = "test-secret";
  mock(headers).mockResolvedValue(hdrs());
  limited.mockResolvedValue(false);
  linkFind.mockResolvedValue({
    id: "link1",
    merchantId: "m1",
    merchant: { isActive: true },
    isActive: true,
    amount: 10,
    chain: "sol",
    token: "usdc",
    expiresAt: null,
    paymentLimit: null,
  });
  findFirst.mockResolvedValue(null);
  create.mockResolvedValue({ id: "new1" });
  mock(resolveAssignment).mockResolvedValue({ ok: true, fields: { chain: "sol" } });
});

describe("/pay/[id]", () => {
  it("rate-limits per IP before any database or chain work", async () => {
    limited.mockResolvedValue(true);
    await open();
    expect(limited).toHaveBeenCalledWith(expect.anything(), "paylink", 20);
    expect(linkFind).not.toHaveBeenCalled();
    expect(resolveAssignment).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("mints no session for a suspended merchant's link", async () => {
    linkFind.mockResolvedValue({
      id: "link1",
      merchantId: "m1",
      merchant: { isActive: false },
      isActive: true,
      amount: 10,
      expiresAt: null,
      paymentLimit: null,
    });
    await open();
    expect(resolveAssignment).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("reuses this visitor's recent untouched session instead of minting", async () => {
    findFirst.mockResolvedValue({ id: "old1" });
    await expect(open()).rejects.toThrow("REDIRECT:/checkout/old1");
    expect(resolveAssignment).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();

    const where = findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      paymentLinkId: "link1",
      status: "pending",
      firstDetectedAt: null,
    });
    expect(where.metadata.path).toEqual(["payLinkClient"]);
  });

  it("mints a session tagged with an opaque fingerprint when none is reusable", async () => {
    await expect(open()).rejects.toThrow("REDIRECT:/checkout/new1");
    const metadata = create.mock.calls[0][0].data.metadata;
    expect(metadata.payLinkClient).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(metadata)).not.toContain("203.0.113.5");
    // The lookup and the stored tag agree, so a reload finds this session.
    expect(findFirst.mock.calls[0][0].where.metadata.equals).toBe(
      metadata.payLinkClient,
    );
  });

  it("gives different visitors different fingerprints", async () => {
    await expect(open()).rejects.toThrow();
    mock(headers).mockResolvedValue(hdrs("198.51.100.7"));
    await expect(open()).rejects.toThrow();
    const [a, b] = create.mock.calls.map((c) => c[0].data.metadata.payLinkClient);
    expect(a).not.toBe(b);
  });

  it("skips reuse when the client IP is unknown", async () => {
    mock(headers).mockResolvedValue(new Headers({ "user-agent": "UA" }));
    await expect(open()).rejects.toThrow("REDIRECT:/checkout/new1");
    expect(findFirst).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].data.metadata.payLinkClient).toBeUndefined();
  });
});
