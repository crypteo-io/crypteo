import { Merchant } from "@/types/payment";
import type { ApiKey, Merchant as MerchantRow } from "@prisma/client";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "./db";

type ResolvedApiKey = ApiKey & { merchant: MerchantRow };

/** The raw API key presented on a request (Bearer or x-api-key), or "". */
export function extractRawApiKey(req: NextRequest): string {
  const authHeader = req.headers.get("Authorization");
  const xApiKey = req.headers.get("x-api-key");

  if (authHeader?.startsWith("Bearer ")) return authHeader.split(" ")[1] ?? "";
  if (xApiKey) return xApiKey;
  return "";
}

// Per-request memo: rateLimit and validateApiKey both need the key row, and a
// public-API request runs both. Keyed weakly on the request object so it dies
// with the request.
const lookups = new WeakMap<NextRequest, Promise<ResolvedApiKey | null>>();

/**
 * Resolve the request's API key to an active key row whose merchant is active,
 * or null. Does not touch lastUsedAt — that's validateApiKey's job.
 */
export function lookupApiKey(req: NextRequest): Promise<ResolvedApiKey | null> {
  const cached = lookups.get(req);
  if (cached) return cached;

  const rawKey = extractRawApiKey(req);
  let result: Promise<ResolvedApiKey | null>;
  if (!rawKey || (!rawKey.startsWith("crypt_") && !rawKey.startsWith("test_"))) {
    result = Promise.resolve(null);
  } else {
    const hash = crypto.createHash("sha256").update(rawKey).digest("hex");
    result = prisma.apiKey
      .findUnique({
        where: { keyHash: hash, isActive: true },
        include: { merchant: true },
      })
      .then((apiKey) =>
        apiKey && apiKey.merchant.isActive ? apiKey : null,
      );
  }
  lookups.set(req, result);
  return result;
}

export async function validateApiKey(
  req: NextRequest,
): Promise<{
  merchant: Merchant;
  isTest: boolean;
  /** Where payments created with this key send webhooks (null = default). */
  webhookEndpointId: string | null;
} | null> {
  const apiKey = await lookupApiKey(req);
  if (!apiKey) return null;

  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(console.error);

  return {
    merchant: apiKey.merchant as unknown as Merchant,
    isTest: apiKey.isTest || false,
    webhookEndpointId: apiKey.webhookEndpointId ?? null,
  };
}
