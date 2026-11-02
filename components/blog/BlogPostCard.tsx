import { LogoMark } from "@/components/site/Logo";
import { formatPostDate, type BlogCard } from "@/lib/blog/queries";
import { cn } from "@/lib/utils";
import { Clock } from "lucide-react";
import Link from "next/link";

// Placeholder covers for posts without an image, picked by slug so a post
// always gets the same one.
const PLACEHOLDERS = [
  "from-sky/25 via-default-100 to-white",
  "from-primary/20 via-sky/10 to-default-50",
  "from-sky-soft/40 via-white to-default-100",
  "from-default-200 via-sky/15 to-white",
];

function placeholderFor(slug: string): string {
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PLACEHOLDERS[hash % PLACEHOLDERS.length];
}

export function BlogCover({
  post,
  className,
  zoom = false,
}: {
  post: Pick<BlogCard, "slug" | "title" | "coverImageUrl">;
  className?: string;
  zoom?: boolean;
}) {
  const motion = zoom
    ? "transition-transform duration-500 group-hover:scale-110"
    : "";
  if (post.coverImageUrl) {
    return (
      // Covers are arbitrary https URLs; next/image would need every host allow-listed.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={post.coverImageUrl}
        alt=""
        loading="lazy"
        className={cn("size-full object-cover", motion, className)}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative flex size-full items-center justify-center overflow-hidden bg-linear-to-br",
        placeholderFor(post.slug),
        motion,
        className,
      )}
    >
      <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/50 blur-2xl" />
      <div className="absolute -bottom-16 left-10 size-40 rounded-full bg-sky/15 blur-2xl" />
      <LogoMark className="relative size-14 opacity-90 shadow-[0_12px_30px_-8px_rgba(6,15,22,0.35)] rounded-[16px]" />
    </div>
  );
}

/** The template's blog card: framed cover, date row, title, excerpt. */
export function BlogPostCard({ post }: { post: BlogCard }) {
  return (
    <article className="group relative rounded-2xl border border-default-200 bg-linear-to-b from-default-100 to-transparent p-2.5">
      <Link
        href={`/blog/${post.slug}`}
        className="absolute inset-0 z-10 rounded-2xl"
        aria-label={post.title}
      />
      <div className="aspect-video overflow-hidden rounded-2xl">
        <BlogCover post={post} zoom />
      </div>
      <div className="p-4 pt-6">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-sm text-default-600">
          <time dateTime={post.publishedAt.toISOString()}>
            {formatPostDate(post.publishedAt)}
          </time>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-default-200 bg-linear-to-b from-default-100 to-transparent px-2.5 py-1">
            <Clock size={14} /> {post.readingMinutes} min read
          </span>
        </div>
        <h2 className="mb-2.5 text-2xl leading-snug">{post.title}</h2>
        <p className="line-clamp-3 text-default-600">{post.excerpt}</p>
      </div>
    </article>
  );
}
