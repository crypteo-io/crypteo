import { NextRequest, NextResponse } from "next/server";
import { extractRawApiKey, lookupApiKey } from "./api-auth";
import { prisma } from "./db";

const WINDOW_MS = 60 * 1000; // 1 minute per window

/**
 * Best-effort client IP. nginx overwrites X-Real-IP (and X-Forwarded-For) with
 * $remote_addr, so X-Real-IP is the trustworthy one. Failing that we take the
 * LAST X-Forwarded-For hop — the one appended by the proxy nearest us. The
 * FIRST entry is whatever the client chose to send, so keying on it let anyone
 * mint a fresh bucket per request by rotating a fake header.
 */
export function clientIp(req: { headers: Pick<Headers, "get"> }): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return "unknown";
}

/**
 * Resolve the rate-limit bucket key and its per-window limit for a request.
 * A *valid* API key gets its own (hashed) bucket; everything else — including
 * an unrecognised key — is bucketed by client IP. Keying on any presented key
 * handed every random `Bearer` string a fresh 120/min allowance.
 */
async function resolveIdentity(
  req: NextRequest,
): Promise<{ key: string; limit: number }> {
  if (extractRawApiKey(req)) {
    try {
      const apiKey = await lookupApiKey(req);
      if (apiKey) {
        return { key: `key:${apiKey.keyHash}`, limit: apiKey.isTest ? 30 : 120 };
      }
    } catch (err) {
      // Fall through to the IP bucket; the route's own validation will fail
      // the request if the key store is genuinely unreachable.
      console.error("[rate-limit] api key lookup failed:", err);
    }
  }

  return { key: `ip:${clientIp(req)}`, limit: 60 };
}

/**
 * Fixed-window rate limiter backed by Postgres so the limit holds across every
 * app replica (the previous in-memory Map counted per-process, so N replicas
 * meant N× the intended limit and every deploy reset all counters).
 *
 * The INSERT ... ON CONFLICT is a single atomic statement — concurrent requests
 * to the same bucket increment safely without a read-modify-write race.
 *
 * Fails open: a rate-limit store hiccup must never take down the whole API.
 *
 * Returns the seconds until the window resets when `key` is over `limit`, or
 * null when the hit is allowed.
 */
async function hitBucket(key: string, limit: number, windowMs = WINDOW_MS): Promise<number | null> {
  const now = new Date();
  const reset = new Date(now.getTime() + windowMs);

  try {
    const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimit" ("key", "count", "resetAt")
      VALUES (${key}, 1, ${reset})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."resetAt" < ${now}
                       THEN 1 ELSE "RateLimit"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimit"."resetAt" < ${now}
                         THEN ${reset} ELSE "RateLimit"."resetAt" END
      RETURNING "count", "resetAt";
    `;

    const row = rows[0];
    if (row && Number(row.count) > limit) {
      return Math.max(
        1,
        Math.ceil((new Date(row.resetAt).getTime() - now.getTime()) / 1000),
      );
    }
    return null;
  } catch (err) {
    console.error("[rate-limit] store error, allowing request:", err);
    return null;
  }
}

function tooManyRequests(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/**
 * General API limiter: a valid API key gets its own bucket, everything else is
 * bucketed by client IP. Returns null when the request is allowed, or a 429
 * response when throttled.
 */
export async function rateLimit(
  req: NextRequest,
): Promise<NextResponse | null> {
  const { key, limit } = await resolveIdentity(req);
  const retryAfter = await hitBucket(key, limit);
  return retryAfter === null ? null : tooManyRequests(retryAfter);
}

/**
 * A separate, per-IP bucket for one expensive or abusable action, on top of
 * (not instead of) the general limit. Scoped so it neither eats nor shares the
 * caller's general API allowance. `limit` is per minute unless `windowMs`
 * says otherwise.
 */
export async function rateLimitScoped(
  req: { headers: Pick<Headers, "get"> },
  scope: string,
  limit: number,
  windowMs = WINDOW_MS,
): Promise<NextResponse | null> {
  const retryAfter = await hitBucket(`${scope}:ip:${clientIp(req)}`, limit, windowMs);
  return retryAfter === null ? null : tooManyRequests(retryAfter);
}

/** A limit on something other than a client IP, such as a Telegram chat. True when over it. */
export async function isOverLimit(key: string, limit: number, windowMs = WINDOW_MS): Promise<boolean> {
  return (await hitBucket(key, limit, windowMs)) !== null;
}

/**
 * The same scoped per-IP limit for server components, which have the request
 * headers (next/headers) but no NextRequest and can't return a 429. Returns
 * true when the caller is over the limit.
 */
export async function isRateLimitedByHeaders(
  headers: Pick<Headers, "get">,
  scope: string,
  limit: number,
): Promise<boolean> {
  return (await hitBucket(`${scope}:ip:${clientIp({ headers })}`, limit)) !== null;
}
