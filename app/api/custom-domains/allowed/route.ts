import { prisma } from "@/lib/db";
import { hostnameOf, isInternalHost } from "@/lib/custom-host";
import { NextRequest, NextResponse } from "next/server";

/**
 * Caddy's `on_demand_tls ask` (caddy/Caddyfile): 200 only for a verified
 * merchant domain, so nobody can make the server request certificates for
 * arbitrary hostnames. Answered to callers on this machine only: through
 * nginx or a custom domain it is a 404, so it needs no rate limit (a shared
 * one would let a burst of junk hostnames lock out real merchants).
 */
export async function GET(req: NextRequest) {
  if (!isInternalHost(req.headers.get("host"))) return new NextResponse(null, { status: 404 });
  const domain = hostnameOf(req.nextUrl.searchParams.get("domain"));
  const found = domain
    ? await prisma.merchant.findFirst({
        where: { customDomain: domain, customDomainVerifiedAt: { not: null }, isActive: true },
        select: { id: true },
      })
    : null;
  return new NextResponse(null, { status: found ? 200 : 404 });
}
