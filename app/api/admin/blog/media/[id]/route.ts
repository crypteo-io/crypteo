import { auditLog, requireAdmin } from "@/lib/admin";
import { blogMediaUrl } from "@/lib/blog/media";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

const ID = /^[a-z0-9]{20,40}$/;
type Params = { params: Promise<{ id: string }> };

/**
 * Delete a gallery image, refused (409) while any post or saved version still
 * shows it: deleting it would leave a broken image on a live page.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "Invalid image id" }, { status: 400 });
  const url = blogMediaUrl(id);

  try {
    const usedBy = await prisma.blogPost.findMany({
      where: { OR: [{ content: { contains: url } }, { coverImageUrl: url }] },
      select: { title: true },
      take: 5,
    });
    if (usedBy.length) {
      return NextResponse.json(
        { error: `Still used in: ${usedBy.map((p) => `"${p.title}"`).join(", ")}. Remove it from those posts first.` },
        { status: 409 },
      );
    }
    const deleted = await prisma.$transaction(async (tx) => {
      const { count } = await tx.blogMedia.deleteMany({ where: { id } });
      if (count) await auditLog(tx, admin, id, "blog.media.delete", {});
      return count > 0;
    });
    if (!deleted) return NextResponse.json({ error: "Image not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/blog/media/:id]", error);
    return NextResponse.json({ error: "Could not delete the image" }, { status: 500 });
  }
}
