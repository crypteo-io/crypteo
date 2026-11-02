import { auth } from "@/lib/auth";
import { brandLogoUrl } from "@/lib/branding";
import { LOGO_MAX_UPLOAD_BYTES, processLogo } from "@/lib/branding-logo";
import { prisma } from "@/lib/db";
import { rateLimit, rateLimitScoped } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

// Each upload decodes an image; a client looping on this would burn CPU.
const LOGO_UPLOADS_PER_MIN = 10;
// Multipart framing on top of the file itself.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Replaces the merchant's checkout logo. Multipart, field `logo`. */
export async function POST(req: NextRequest) {
  const rl =
    (await rateLimit(req)) ??
    (await rateLimitScoped(req, "brand-logo-upload", LOGO_UPLOADS_PER_MIN));
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Refuse an oversized body before buffering it.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > LOGO_MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES)
    return NextResponse.json(
      { error: "Logo must be 2 MB or smaller" },
      { status: 413 },
    );

  const form = await req.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof File))
    return NextResponse.json({ error: "Choose an image to upload" }, { status: 400 });
  if (file.size > LOGO_MAX_UPLOAD_BYTES)
    return NextResponse.json(
      { error: "Logo must be 2 MB or smaller" },
      { status: 413 },
    );

  const logo = await processLogo(Buffer.from(await file.arrayBuffer()));
  if (!logo.ok) return NextResponse.json({ error: logo.error }, { status: 400 });

  // A new row (new id) per upload: the public URL embeds the id and is cached
  // as immutable, so replacing in place would keep serving the old image.
  const [, created] = await prisma.$transaction([
    prisma.merchantLogo.deleteMany({ where: { merchantId: session.user.id } }),
    prisma.merchantLogo.create({
      data: {
        merchantId: session.user.id,
        contentType: logo.contentType,
        width: logo.width,
        height: logo.height,
        data: logo.data,
      },
      select: { id: true, width: true, height: true },
    }),
  ]);

  return NextResponse.json({
    success: true,
    logo: { url: brandLogoUrl(created.id), width: created.width, height: created.height },
  });
}

export async function DELETE(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.merchantLogo.deleteMany({ where: { merchantId: session.user.id } });
  return NextResponse.json({ success: true });
}
