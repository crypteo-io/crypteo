import { auditLog, requireAdmin } from "@/lib/admin";
import {
  BLOG_MEDIA_MAX_HEIGHT_PX,
  BLOG_MEDIA_MAX_UPLOAD_BYTES,
  BLOG_MEDIA_MAX_WIDTH_PX,
  blogMediaUrl,
  MAX_ALT_LENGTH,
} from "@/lib/blog/media";
import { prisma } from "@/lib/db";
import { processImage } from "@/lib/images";
import { rateLimit, rateLimitScoped } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

// The gallery shows the newest uploads; past this many it needs paging.
const MAX_MEDIA_LISTED = 300;
// Each upload decodes an image; a looping client would burn CPU.
const UPLOADS_PER_MIN = 20;
// Multipart framing on top of the file itself.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const MEDIA_SELECT = {
  id: true,
  createdAt: true,
  width: true,
  height: true,
  sizeBytes: true,
  alt: true,
} as const;

const withUrl = <T extends { id: string }>(m: T) => ({ ...m, url: blogMediaUrl(m.id) });

/** The gallery, newest first; metadata only, never the bytes. */
export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { response } = await requireAdmin();
  if (response) return response;

  try {
    const media = await prisma.blogMedia.findMany({
      orderBy: { createdAt: "desc" },
      take: MAX_MEDIA_LISTED,
      select: MEDIA_SELECT,
    });
    return NextResponse.json({ media: media.map(withUrl) });
  } catch (error) {
    console.error("[admin/blog/media]", error);
    return NextResponse.json({ error: "Could not load the gallery" }, { status: 500 });
  }
}

/** Upload one image (multipart: `image`, optional `alt`), re-encoded to WebP. */
export async function POST(req: NextRequest) {
  const rl = (await rateLimit(req)) ?? (await rateLimitScoped(req, "blog-media-upload", UPLOADS_PER_MIN));
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const tooBig = NextResponse.json(
    { error: `Images must be ${BLOG_MEDIA_MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller` },
    { status: 413 },
  );
  if (Number(req.headers.get("content-length") ?? 0) > BLOG_MEDIA_MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return tooBig;
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an image to upload" }, { status: 400 });
  }
  if (file.size > BLOG_MEDIA_MAX_UPLOAD_BYTES) return tooBig;
  const rawAlt = form?.get("alt");
  const alt = typeof rawAlt === "string" ? rawAlt.trim().slice(0, MAX_ALT_LENGTH) || null : null;

  const image = await processImage(Buffer.from(await file.arrayBuffer()), {
    maxUploadBytes: BLOG_MEDIA_MAX_UPLOAD_BYTES,
    maxWidthPx: BLOG_MEDIA_MAX_WIDTH_PX,
    maxHeightPx: BLOG_MEDIA_MAX_HEIGHT_PX,
    noun: "Image",
  });
  if (!image.ok) return NextResponse.json({ error: image.error }, { status: 400 });

  try {
    const media = await prisma.$transaction(async (tx) => {
      const created = await tx.blogMedia.create({
        data: {
          uploadedBy: admin.id,
          contentType: image.contentType,
          width: image.width,
          height: image.height,
          sizeBytes: image.data.length,
          alt,
          data: image.data,
        },
        select: MEDIA_SELECT,
      });
      await auditLog(tx, admin, created.id, "blog.media.upload", { width: image.width, height: image.height });
      return created;
    });
    return NextResponse.json({ media: withUrl(media) }, { status: 201 });
  } catch (error) {
    console.error("[admin/blog/media]", error);
    return NextResponse.json({ error: "Could not save the image" }, { status: 500 });
  }
}
