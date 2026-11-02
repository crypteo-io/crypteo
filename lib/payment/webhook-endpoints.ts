import { prisma } from "../db";
import { z } from "zod";

/** What the endpoint API returns for each endpoint. */
export const ENDPOINT_FIELDS = {
  id: true,
  url: true,
  label: true,
  isActive: true,
  isDefault: true,
  createdAt: true,
} as const;

/** Body of a create/edit request for a merchant webhook endpoint. */
export const endpointInputSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2048, "URL is too long")
    .url("Enter a full URL, e.g. https://your-site.com/webhooks/crypteo"),
  label: z
    .string()
    .trim()
    .max(60, "Label must be at most 60 characters")
    .nullish()
    // Absent stays absent (a PATCH that only pauses must not clear the
    // label); an empty label is stored as none.
    .transform((v) => (v === undefined ? undefined : v || null)),
});

/** The signed event "Send test" posts: no payment, so handlers can ignore it. */
export function testWebhookPayload(endpointId: string, now: Date = new Date()) {
  return {
    event: "webhook.test",
    eventId: `test:${endpointId}:${now.getTime()}`,
    payment: null,
    timestamp: now.toISOString(),
  };
}

/**
 * Why a link or API key can't send to `endpointId`, or null. Only the
 * merchant's own endpoints: an id is not a secret, and another merchant's
 * endpoint would receive this merchant's payments.
 */
export async function refuseEndpointChoice(
  merchantId: string,
  endpointId: string | null | undefined,
): Promise<string | null> {
  if (!endpointId) return null;
  const endpoint = await prisma.webhookEndpoint.findUnique({
    where: { id: endpointId },
    select: { merchantId: true },
  });
  return endpoint?.merchantId === merchantId ? null : "Unknown webhook endpoint";
}
