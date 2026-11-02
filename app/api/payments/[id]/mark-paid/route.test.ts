import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/payment/notify", () => ({ triggerNotifications: vi.fn() }));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { triggerNotifications } from "@/lib/payment/notify";
import { POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const updateMany = mock(prisma.payment.updateMany);

function markPaid() {
  return POST(
    new NextRequest("https://app.example/api/payments/p1/mark-paid", { method: "POST" }),
    { params: Promise.resolve({ id: "p1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(auth).mockResolvedValue({ user: { id: "m1" } });
  mock(prisma.payment.findUnique).mockResolvedValue({
    id: "p1",
    merchantId: "m1",
    isTest: false,
    status: "underpaid",
    receivedAmount: 0.5,
  });
  mock(prisma.payment.findUniqueOrThrow).mockResolvedValue({
    id: "p1",
    status: "confirmed",
  });
});

describe("POST /api/payments/[id]/mark-paid", () => {
  it("writes only if the status is still the one validated", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const res = await markPaid();
    expect(res.status).toBe(200);
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: "p1", status: "underpaid" },
      data: { status: "confirmed" },
    });
    expect(triggerNotifications).toHaveBeenCalledOnce();
  });

  it("409s without notifying when the worker moved the session first", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const res = await markPaid();
    expect(res.status).toBe(409);
    expect(triggerNotifications).not.toHaveBeenCalled();
  });
});
