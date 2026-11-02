import type { Prisma } from "@prisma/client";

// Every save of a post is kept as a version, newest first, up to this many;
// older ones are dropped in the same transaction so the table stays bounded.
export const MAX_VERSIONS_PER_POST = 100;

export type VersionEvent = "create" | "save" | "publish" | "unpublish";

export interface VersionSnapshot {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  format: string;
  coverImageUrl: string | null;
  status: string;
}

/** The event a save records: a status change wins over a plain save. */
export function versionEvent(before: string | null, after: string): VersionEvent {
  if (before === null) return "create";
  if (before !== after) return after === "published" ? "publish" : "unpublish";
  return "save";
}

/** Snapshot the post as just written, then trim the oldest past the cap. */
export async function recordVersion(
  tx: Prisma.TransactionClient,
  post: VersionSnapshot,
  adminId: string,
  event: VersionEvent,
): Promise<void> {
  await tx.blogPostVersion.create({
    data: {
      postId: post.id,
      createdBy: adminId,
      event,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      content: post.content,
      format: post.format,
      coverImageUrl: post.coverImageUrl,
      status: post.status,
    },
  });
  const stale = await tx.blogPostVersion.findMany({
    where: { postId: post.id },
    orderBy: { createdAt: "desc" },
    skip: MAX_VERSIONS_PER_POST,
    select: { id: true },
  });
  if (stale.length) {
    await tx.blogPostVersion.deleteMany({ where: { id: { in: stale.map((v) => v.id) } } });
  }
}
