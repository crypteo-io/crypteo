import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

/**
 * A blog gallery image. Public, since readers load it. Each upload gets a new
 * id and is never edited in place, so a response can be cached for a year.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/.test(id)) return new NextResponse(null, { status: 404 });

  const media = await prisma.blogMedia.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });
  if (!media) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(media.data), {
    headers: {
      "Content-Type": media.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
