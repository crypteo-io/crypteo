import { prisma } from "@/lib/db";
import { hostnameOf } from "@/lib/custom-host";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/**
 * For a self-hosted proxy that issues certificates on demand (Caddy's
 * `on_demand_tls ask`): 200 only for a verified merchant domain, so nobody
 * can make the server request certificates for arbitrary hostnames.
 */
export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const domain = hostnameOf(req.nextUrl.searchParams.get("domain"));
  const found = domain
    ? await prisma.merchant.findFirst({
        where: { customDomain: domain, customDomainVerifiedAt: { not: null }, isActive: true },
        select: { id: true },
      })
    : null;
  return new NextResponse(null, { status: found ? 200 : 404 });
}
