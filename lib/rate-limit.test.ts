import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  prisma: { $queryRaw: vi.fn(), apiKey: { findUnique: vi.fn() } },
}));

import { prisma } from "./db";
import {
  clientIp,
  isRateLimitedByHeaders,
  rateLimit,
  rateLimitScoped,
} from "./rate-limit";

const queryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;
const findKey = prisma.apiKey.findUnique as unknown as ReturnType<typeof vi.fn>;

function req(headers: Record<string, string>) {
  return new NextRequest("https://app.example/api/x", { headers });
}

/** The bucket key passed to the INSERT (first interpolated value). */
function bucketOf(call: unknown[]) {
  return call[1] as string;
}

beforeEach(() => {
  queryRaw.mockReset().mockResolvedValue([{ count: 1, resetAt: new Date() }]);
  findKey.mockReset().mockResolvedValue(null);
});

describe("clientIp", () => {
  it("prefers X-Real-IP (set by nginx from $remote_addr)", () => {
    expect(
      clientIp(req({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "1.1.1.1" })),
    ).toBe("203.0.113.5");
  });

  it("uses the LAST X-Forwarded-For hop, not the client-supplied first", () => {
    expect(
      clientIp(req({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 198.51.100.9" })),
    ).toBe("198.51.100.9");
  });

  it("ignores empty hops", () => {
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 198.51.100.9 ," }))).toBe(
      "198.51.100.9",
    );
  });

  it("falls back to 'unknown'", () => {
    expect(clientIp(req({}))).toBe("unknown");
  });
});

describe("rateLimit bucketing", () => {
  it("buckets an unrecognised Bearer key by IP, not by the key", async () => {
    await rateLimit(
      req({ authorization: "Bearer crypt_random123", "x-real-ip": "203.0.113.5" }),
    );
    expect(bucketOf(queryRaw.mock.calls[0])).toBe("ip:203.0.113.5");
  });

  it("does not even look up keys without a known prefix", async () => {
    await rateLimit(req({ authorization: "Bearer junk", "x-real-ip": "1.2.3.4" }));
    expect(findKey).not.toHaveBeenCalled();
    expect(bucketOf(queryRaw.mock.calls[0])).toBe("ip:1.2.3.4");
  });

  it("gives a valid key its own bucket", async () => {
    findKey.mockResolvedValue({
      id: "k1",
      keyHash: "abc",
      isTest: false,
      merchant: { isActive: true },
    });
    await rateLimit(req({ "x-api-key": "crypt_real", "x-real-ip": "1.2.3.4" }));
    expect(bucketOf(queryRaw.mock.calls[0])).toBe("key:abc");
  });

  it("treats a key of a deactivated merchant as unvalidated", async () => {
    findKey.mockResolvedValue({
      id: "k1",
      keyHash: "abc",
      isTest: false,
      merchant: { isActive: false },
    });
    await rateLimit(req({ "x-api-key": "crypt_real", "x-real-ip": "1.2.3.4" }));
    expect(bucketOf(queryRaw.mock.calls[0])).toBe("ip:1.2.3.4");
  });

  it("returns 429 once over the limit", async () => {
    queryRaw.mockResolvedValue([
      { count: 61, resetAt: new Date(Date.now() + 30_000) },
    ]);
    const res = await rateLimit(req({ "x-real-ip": "1.2.3.4" }));
    expect(res?.status).toBe(429);
  });
});

describe("scoped limits", () => {
  it("rateLimitScoped uses its own per-IP bucket", async () => {
    await rateLimitScoped(req({ "x-real-ip": "203.0.113.5" }), "simulate", 10);
    expect(bucketOf(queryRaw.mock.calls[0])).toBe("simulate:ip:203.0.113.5");
  });

  it("rateLimitScoped returns 429 past its own limit", async () => {
    queryRaw.mockResolvedValue([
      { count: 11, resetAt: new Date(Date.now() + 30_000) },
    ]);
    const res = await rateLimitScoped(req({ "x-real-ip": "1.2.3.4" }), "s", 10);
    expect(res?.status).toBe(429);
  });

  it("isRateLimitedByHeaders keys on X-Real-IP then the last XFF hop", async () => {
    await isRateLimitedByHeaders(
      new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.9" }),
      "paylink",
      20,
    );
    expect(bucketOf(queryRaw.mock.calls[0])).toBe("paylink:ip:198.51.100.9");
  });

  it("isRateLimitedByHeaders reports over-limit and fails open on store errors", async () => {
    queryRaw.mockResolvedValueOnce([
      { count: 21, resetAt: new Date(Date.now() + 30_000) },
    ]);
    expect(await isRateLimitedByHeaders(new Headers(), "paylink", 20)).toBe(true);

    queryRaw.mockRejectedValueOnce(new Error("db down"));
    expect(await isRateLimitedByHeaders(new Headers(), "paylink", 20)).toBe(false);
  });
});
