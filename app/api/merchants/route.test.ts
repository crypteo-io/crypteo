import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { merchant: { update: vi.fn(), findUnique: vi.fn() }, $transaction: vi.fn(async () => []) },
}));
vi.mock("@/lib/admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin")>()),
  softDeleteMerchantOps: vi.fn(async () => []),
  wouldRemoveLastAdmin: vi.fn(async () => false),
}));
vi.mock("argon2", () => ({ hash: vi.fn(), verify: vi.fn(async (_h: string, p: string) => p === "Right-Pass!1") }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(), rateLimitScoped: vi.fn() }));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DELETE, PUT } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const update = mock(prisma.merchant.update);

function put(body: unknown) {
  return PUT(
    new NextRequest("https://app.example/api/merchants", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(auth).mockResolvedValue({ user: { id: "m1" } });
  mock(prisma.merchant.findUnique).mockResolvedValue({ role: "merchant" });
});

describe("PUT /api/merchants name validation", () => {
  it("lets an admin, and only an admin, take a reserved name", async () => {
    expect((await put({ name: "Crypteo" })).status).toBe(400);
    mock(prisma.merchant.findUnique).mockResolvedValue({ role: "admin" });
    expect((await put({ name: "Crypteo" })).status).toBe(200);
    expect(update.mock.calls[0][0].data).toEqual({ name: "Crypteo" });
  });

  it("stores a trimmed name", async () => {
    const res = await put({ name: "  Acme Shop  " });
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data).toEqual({ name: "Acme Shop" });
  });

  it.each([
    ["missing", {}],
    ["non-string", { name: { $ne: 1 } }],
    ["blank", { name: "   " }],
    ["too long", { name: "a".repeat(101) }],
    ["control chars", { name: "Acme\r\nBcc: x" }],
    ["bidi override", { name: "Acme‮gnp.exe" }],
  ])("rejects a %s name", async (_, body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/merchants asks for the password (pen-test 2026-11-15)", () => {
  const del = (body?: unknown) =>
    DELETE(
      new NextRequest("https://app.example/api/merchants", {
        method: "DELETE",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  beforeEach(() => mock(prisma.merchant.findUnique).mockResolvedValue({ password: "hash" }));

  it("refuses a session alone, or the wrong password, and deletes nothing", async () => {
    expect((await del()).status).toBe(400);
    expect((await del({ password: "guess" })).status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("deletes with the right password", async () => {
    expect((await del({ password: "Right-Pass!1" })).status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
