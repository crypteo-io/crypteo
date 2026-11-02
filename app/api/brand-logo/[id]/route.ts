import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

/**
 * A merchant's checkout logo. Public, because buyers load it. The id changes
 * on every upload, so a response is never stale and can be cached for a year.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/.test(id))
    return new NextResponse(null, { status: 404 });

  const logo = await prisma.merchantLogo.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });
  if (!logo) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
