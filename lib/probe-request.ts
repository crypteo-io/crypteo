import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { recordRiskEvent } from "./account-risk";
import { lookupApiKey } from "./api-auth";

/**
 * A request carrying an injection payload, from a signed-in merchant or an API
 * key, counts against that account (lib/account-risk.ts). Anonymous ones are
 * the monitor's (lib/probe-traffic.ts).
 */
export async function noteProbeRequest(req: NextRequest, kind: string): Promise<void> {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    const merchantId =
      (typeof token?.id === "string" ? token.id : null) ?? (await lookupApiKey(req).catch(() => null))?.merchantId ?? null;
    if (!merchantId) return;
    const target = `${req.method} ${req.nextUrl.pathname}${req.nextUrl.search}`;
    await recordRiskEvent(merchantId, "probe_request", `${kind}: ${readable(target).slice(0, 200)}`);
  } catch (error) {
    console.error("[probe-request] not recorded:", error);
  }
}

/** Decoded for an admin to read; a malformed escape (itself a probe) stays as sent. */
function readable(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}
