import { requireAdmin } from "@/lib/admin";
import { MAX_VERSIONS_PER_POST } from "@/lib/blog/versions";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

const ID = /^[a-z0-9]{20,40}$/;
type Params = { params: Promise<{ id: string }> };

/** A post's saved versions, newest first; bodies are fetched one at a time. */
export async function GET(req: NextRequest, { params }: Params) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });

  try {
    const rows = await prisma.blogPostVersion.findMany({
      where: { postId: id },
      orderBy: { createdAt: "desc" },
      take: MAX_VERSIONS_PER_POST,
      select: { id: true, createdAt: true, createdBy: true, event: true, title: true, status: true },
    });
    const authors = await prisma.merchant.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.createdBy))] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(authors.map((a) => [a.id, a.name]));
    const versions = rows.map(({ createdBy, ...v }) => ({ ...v, author: nameOf.get(createdBy) ?? "Unknown" }));
    return NextResponse.json({ versions });
  } catch (error) {
    console.error("[admin/blog/:id/versions]", error);
    return NextResponse.json({ error: "Could not load versions" }, { status: 500 });
  }
}
