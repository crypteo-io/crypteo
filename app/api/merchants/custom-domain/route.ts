import { auth } from "@/lib/auth";
import { customDomainSchema, newVerificationToken } from "@/lib/custom-domain";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({ domain: customDomainSchema });

/** Starts (or restarts) a custom domain: saved unverified, with a fresh TXT token. */
export async function PUT(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid domain", field: "domain" }, { status: 400 });
  }
  const { domain } = parsed.data;

  // Only proof of ownership holds a domain: an unverified claim never blocks
  // its real owner (anyone could squat on pay.yourstore.com otherwise).
  await prisma.merchant.updateMany({
    where: { customDomain: domain, customDomainVerifiedAt: null, NOT: { id: session.user.id } },
    data: { customDomain: null, customDomainToken: null },
  });
  try {
    const saved = await prisma.merchant.update({
      where: { id: session.user.id },
      data: { customDomain: domain, customDomainToken: newVerificationToken(), customDomainVerifiedAt: null },
      select: { customDomain: true, customDomainToken: true },
    });
    return NextResponse.json(saved);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Another account has already verified that domain.", field: "domain" }, { status: 409 });
    }
    throw err;
  }
}

/** Stops serving payment links on the custom domain. */
export async function DELETE(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.merchant.update({
    where: { id: session.user.id },
    data: { customDomain: null, customDomainToken: null, customDomainVerifiedAt: null },
  });
  return NextResponse.json({ success: true });
}
