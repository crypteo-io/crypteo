import { flagProbeInput } from "@/lib/abuse-signals";
import { auth } from "@/lib/auth";
import { brandNameSchema, checkoutFooterSchema, normalizeBrandColor } from "@/lib/branding";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { reservedNameRefusal } from "@/lib/reserved-names";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = checkoutFooterSchema.partial().extend({
  brandColor: z.string().max(16).nullable().optional(),
  brandName: brandNameSchema.nullable().optional(),
});

/**
 * Sets any of the checkout's name (null = the account name), colour (null =
 * Crypteo's) and footer fields; omitted fields keep their value.
 */
export async function PUT(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? "Invalid branding", field: issue?.path[0] },
      { status: 400 },
    );
  }

  const { brandColor: rawColor, brandName, ...footer } = parsed.data;
  if (brandName) {
    // The same rule as account names: nobody checks out as "Crypteo".
    const account = await prisma.merchant.findUnique({ where: { id: session.user.id }, select: { role: true } });
    const refusal = account ? reservedNameRefusal(brandName, account.role) : "Account not found";
    if (refusal) return NextResponse.json({ error: refusal, field: "brandName" }, { status: 400 });
  }
  let brandColor: string | null | undefined = rawColor;
  if (rawColor) {
    brandColor = normalizeBrandColor(rawColor);
    if (!brandColor)
      return NextResponse.json(
        { error: "Use a hex colour such as #135ca4", field: "brandColor" },
        { status: 400 },
      );
  }

  const saved = await prisma.merchant.update({
    where: { id: session.user.id },
    data: { brandColor, brandName, ...footer },
    select: {
      brandName: true,
      brandColor: true,
      supportEmail: true,
      supportLinkLabel: true,
      supportLinkUrl: true,
      showPoweredBy: true,
      showSupportEmail: true,
    },
  });
  if (brandName) await flagProbeInput(session.user.id, "Checkout name", { name: brandName });
  return NextResponse.json({ success: true, ...saved });
}
