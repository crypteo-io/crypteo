import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { merchant: { findFirst: vi.fn() } } }));

import { prisma } from "@/lib/db";
import { GET } from "./route";

const findFirst = prisma.merchant.findFirst as unknown as ReturnType<typeof vi.fn>;
const ask = (host: string, domain = "pay.shop.com") =>
  GET(new NextRequest(`http://${host}/api/custom-domains/allowed?domain=${domain}`, { headers: { host } }));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/custom-domains/allowed", () => {
  it("authorises a verified domain for Caddy on the internal network", async () => {
    findFirst.mockResolvedValue({ id: "m1" });
    expect((await ask("app:3000")).status).toBe(200);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ customDomain: "pay.shop.com", isActive: true });
  });

  it("refuses an unknown domain", async () => {
    findFirst.mockResolvedValue(null);
    expect((await ask("app:3000", "junk.example.com")).status).toBe(404);
  });

  it("never answers through a public hostname", async () => {
    findFirst.mockResolvedValue({ id: "m1" });
    expect((await ask("crypteo.io")).status).toBe(404);
    expect((await ask("pay.shop.com")).status).toBe(404);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
