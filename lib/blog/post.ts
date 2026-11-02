import { z } from "zod";
import { isAllowedImageSrc } from "./media";

export const BLOG_STATUSES = ["draft", "published"] as const;
export type BlogStatus = (typeof BLOG_STATUSES)[number];

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SLUG_LENGTH = 120;
export const MAX_TITLE_LENGTH = 200;
export const MAX_EXCERPT_LENGTH = 320;
// Generous for a long article (HTML is wordier than Markdown); caps what one
// request can make us store and render.
export const MAX_CONTENT_LENGTH = 200_000;
export const MAX_COVER_URL_LENGTH = 2_000;

const WORDS_PER_MINUTE = 220;

export const SLUG_TAKEN = "A post with this slug already exists. Pick another slug.";

export const BLOG_PAGE_SIZE = 12;
// Past this many pages the listing stops; offsets stay bounded however many posts exist.
export const MAX_BLOG_PAGE = 100;

/** A URL slug from a title: lowercase ASCII words joined by single hyphens. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");
}

export function isValidSlug(slug: string): boolean {
  return slug.length <= MAX_SLUG_LENGTH && SLUG_RE.test(slug);
}

/** Whole minutes to read a body (Markdown or HTML), never less than one. */
export function readingTimeMinutes(body: string): number {
  const words = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<pre[\s\S]*?<\/pre>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`~[\]()!|-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** The ?page= value as a page number in [1, MAX_BLOG_PAGE]. */
export function parseBlogPage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_BLOG_PAGE);
}

const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required")
  .max(MAX_SLUG_LENGTH, `Slug must be at most ${MAX_SLUG_LENGTH} characters`)
  .regex(SLUG_RE, "Slug may only contain lowercase letters, numbers and single hyphens");

const coverImageSchema = z
  .string()
  .trim()
  .max(MAX_COVER_URL_LENGTH, "Cover image URL is too long")
  .nullish()
  // Absent stays absent (an update that doesn't mention the cover keeps it);
  // an empty field clears it.
  .transform((v) => (v === undefined ? undefined : v || null))
  .refine((v) => v == null || isAllowedImageSrc(v), {
    message: "Cover image must be a gallery image or an https:// URL",
  });

const fields = {
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(MAX_TITLE_LENGTH, `Title must be at most ${MAX_TITLE_LENGTH} characters`),
  slug: slugSchema,
  excerpt: z
    .string()
    .trim()
    .min(1, "Excerpt is required")
    .max(MAX_EXCERPT_LENGTH, `Excerpt must be at most ${MAX_EXCERPT_LENGTH} characters`),
  content: z
    .string()
    .min(1, "Content is required")
    .max(MAX_CONTENT_LENGTH, `Content must be at most ${MAX_CONTENT_LENGTH} characters`),
  coverImageUrl: coverImageSchema,
  status: z.enum(BLOG_STATUSES),
  format: z.enum(["html", "markdown"]),
};

export const createPostSchema = z.object({
  ...fields,
  status: fields.status.default("draft"),
  format: fields.format.default("html"),
});

export const updatePostSchema = z
  .object(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

/**
 * publishedAt for a post moving to `status`. Set on the first publish and
 * kept from then on, unpublishing included, so a post taken down and put back
 * keeps its original date and place in the listing.
 */
export function nextPublishedAt(
  status: BlogStatus,
  current: Date | null,
  now: Date = new Date(),
): Date | null {
  if (current) return current;
  return status === "published" ? now : null;
}
