import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: { findUnique: vi.fn(), updateMany: vi.fn() },
    emailLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/mailer", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
  rateLimitScoped: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/mailer";
import { rateLimitScoped } from "@/lib/rate-limit";
import { POST } from "./route";

const findUnique = prisma.payment.findUnique as unknown as ReturnType<typeof vi.fn>;
const updateMany = prisma.payment.updateMany as unknown as ReturnType<typeof vi.fn>;
const mail = sendEmail as unknown as ReturnType<typeof vi.fn>;
const scoped = rateLimitScoped as unknown as ReturnType<typeof vi.fn>;

const view = {
  id: "p1",
  status: "confirmed",
  chain: "eth",
  token: "eth",
  expectedAmount: 1,
  receivedAmount: 1,
  walletAddress: "0xabc",
  xrpDestinationTag: null,
  solMemoString: null,
  txHash: null,
  confirmations: 12,
  createdAt: new Date(),
  expiresAt: new Date(),
  isTest: true,
};

function call() {
  return POST(new NextRequest("https://app.example/api/payments/p1/simulate", { method: "POST" }), {
    params: Promise.resolve({ id: "p1" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  scoped.mockResolvedValue(null);
  findUnique.mockReset();
  findUnique
    .mockResolvedValueOnce({
      ...view,
      status: "pending",
      customerEmail: "<b>x</b>@e.com",
      merchant: { name: "M<script>", email: "m@example.com" },
    })
    .mockResolvedValueOnce(view);
  mail.mockResolvedValue({ success: true });
});

describe("POST /api/payments/[id]/simulate", () => {
  it("never selects or returns merchant-side fields", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const res = await call();
    const body = await res.json();

    const select = findUnique.mock.calls[0][0].select;
    expect(select.merchant).toEqual({ select: { name: true, email: true } });
    expect(select.webhookUrl).toBeUndefined();
    expect(select.metadata).toBeUndefined();
    expect(findUnique.mock.calls[1][0].select.customerEmail).toBeUndefined();

    expect(Object.keys(body.payment).sort()).toEqual(Object.keys(view).sort());
    expect(JSON.stringify(body)).not.toMatch(/password|webhookSecret|m@example\.com/);
  });

  it("escapes attacker-supplied values in the email", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await call();
    const html = mail.mock.calls[0][0].html as string;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x</b>");
  });

  it("only emails when this call flipped the status (race-safe idempotence)", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const res = await call();
    expect(res.status).toBe(200);
    expect(mail).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[0][0].where).toEqual({
      id: "p1",
      isTest: true,
      status: { not: "confirmed" },
    });
  });

  it("refuses live sessions", async () => {
    findUnique.mockReset().mockResolvedValue({ ...view, isTest: false, merchant: {} });
    const res = await call();
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("applies the dedicated simulate rate limit", async () => {
    scoped.mockResolvedValue(new Response(null, { status: 429 }));
    const res = await call();
    expect(res.status).toBe(429);
    expect(findUnique).not.toHaveBeenCalled();
    expect(scoped).toHaveBeenCalledWith(expect.anything(), "simulate", 10);
  });
});
