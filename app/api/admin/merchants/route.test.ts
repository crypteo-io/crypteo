import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { merchant: { create: vi.fn() }, adminAuditLog: { create: vi.fn() } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(), clientIp: () => "203.0.113.5" }));
vi.mock("argon2", () => ({ hash: vi.fn(async () => "hashed") }));
vi.mock("@/lib/admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin")>()),
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/admin-grant", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-grant")>()),
  confirmsOwnPassword: vi.fn(),
  announceAdminGrant: vi.fn(),
}));

import { requireAdmin } from "@/lib/admin";
import { announceAdminGrant, confirmsOwnPassword } from "@/lib/admin-grant";
import { prisma } from "@/lib/db";
import { POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const ADMIN = { id: "cadmin0000000000000000001", email: "admin@x.co" };

function create(body: Record<string, unknown>) {
  return POST(
    new NextRequest("https://admin.example/api/admin/merchants", {
      method: "POST",
      body: JSON.stringify({ name: "Ops", email: "ops@x.co", password: "Str0ng-Pass!", ...body }),
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mock(requireAdmin).mockResolvedValue({ admin: ADMIN });
  mock(prisma.merchant.create).mockResolvedValue({ id: "cnew00000000000000000001" });
});

describe("POST /api/admin/merchants", () => {
  it("creates an admin only with the acting admin's password, and tells every admin", async () => {
    mock(confirmsOwnPassword).mockResolvedValue(false);
    expect((await create({ role: "admin", adminPassword: "wrong" })).status).toBe(403);
    expect(prisma.merchant.create).not.toHaveBeenCalled();

    mock(confirmsOwnPassword).mockResolvedValue(true);
    expect((await create({ role: "admin", adminPassword: "R1ght-Pass!" })).status).toBe(201);
    expect(announceAdminGrant).toHaveBeenCalledWith(expect.objectContaining({ accountEmail: "ops@x.co", grantedBy: ADMIN.email }));
  });

  it("creates a merchant without asking, and never on a platform address", async () => {
    expect((await create({ role: "merchant" })).status).toBe(201);
    expect(confirmsOwnPassword).not.toHaveBeenCalled();
    expect(announceAdminGrant).not.toHaveBeenCalled();
    expect((await create({ role: "merchant", email: "x@crypteo.io" })).status).toBe(400);
  });
});
