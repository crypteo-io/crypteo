import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { payment: { findMany: vi.fn(), count: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/security", () => ({ isSafeWebhookUrl: vi.fn() }));
vi.mock("@/lib/payment/assign", () => ({
  ORIGINAL_USD_KEY: "originalUsdAmount",
  positiveAmountSchema: {},
  resolveAssignment: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { GET } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const findMany = mock(prisma.payment.findMany);

function list(qs: string) {
  return GET(new NextRequest(`https://app.example/api/payments?${qs}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(auth).mockResolvedValue({ user: { id: "m1" } });
  findMany.mockResolvedValue([]);
  mock(prisma.payment.count).mockResolvedValue(0);
});

describe("GET /api/payments paging", () => {
  it.each([
    ["limit=1000000", 100, 0],
    ["limit=0", 1, 0],
    ["limit=-5&page=-3", 1, 0],
    ["limit=abc&page=xyz", 10, 0],
    ["limit=20&page=3", 20, 40],
  ])("%s → take %i, skip %i", async (qs, take, skip) => {
    const res = await list(qs);
    expect(res.status).toBe(200);
    expect(findMany.mock.calls[0][0]).toMatchObject({ take, skip });
  });
});
