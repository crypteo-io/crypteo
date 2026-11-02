import { auth } from "@/lib/auth";
import { cnameTarget, hasVerificationRecord, registerHostname, verificationName } from "@/lib/custom-domain";
import { prisma } from "@/lib/db";
import { notifyAccountSecurityChange } from "@/lib/mailer";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/**
 * Checks the TXT record and, when it matches, starts serving payment links
 * on the domain. Written only if the domain and token are still the ones
 * checked, so a change made meanwhile is never verified by an old record.
 */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const merchant = await prisma.merchant.findUnique({
    where: { id: session.user.id },
    select: { email: true, name: true, role: true, customDomain: true, customDomainToken: true, customDomainVerifiedAt: true },
  });
  const { customDomain: domain, customDomainToken: token } = merchant ?? {};
  if (!merchant || !domain || !token) return NextResponse.json({ error: "Add a domain first." }, { status: 400 });
  if (merchant.customDomainVerifiedAt) return NextResponse.json({ verified: true });

  if (!(await hasVerificationRecord(domain, token))) {
    return NextResponse.json(
      { error: `No matching TXT record at ${verificationName(domain)} yet. DNS changes can take a few minutes.` },
      { status: 422 },
    );
  }
  if (!(await registerHostname(domain))) {
    return NextResponse.json({ error: "Your domain checks out, but we couldn't set up its certificate. Try again shortly." }, { status: 502 });
  }

  const { count } = await prisma.merchant.updateMany({
    where: { id: session.user.id, customDomain: domain, customDomainToken: token, customDomainVerifiedAt: null },
    data: { customDomainVerifiedAt: new Date() },
  });
  if (count === 1) {
    void notifyAccountSecurityChange({
      to: merchant.email,
      merchantName: merchant.name,
      action: "Custom domain connected",
      details: [
        { label: "Domain", value: domain },
        { label: "CNAME target", value: cnameTarget() },
      ],
      ip: clientIp(req),
      reviewPath: "/dashboard/payment-links",
      role: merchant.role,
    });
  }
  return NextResponse.json({ verified: count === 1 });
}
