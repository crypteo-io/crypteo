// Blog gallery images: one rule for what an image URL may be, shared by the
// sanitiser, the cover field and the media API. Client-safe (no database).

export const BLOG_MEDIA_PATH = "/api/blog-media/";
/** Uploads are re-encoded to WebP at most this size (lib/images.ts). */
export const BLOG_MEDIA_MAX_WIDTH_PX = 2000;
export const BLOG_MEDIA_MAX_HEIGHT_PX = 2000;
export const BLOG_MEDIA_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_ALT_LENGTH = 200;

const MEDIA_URL_RE = /^\/api\/blog-media\/[a-z0-9]{20,40}$/;
const HTTPS_URL_RE = /^https:\/\/\S+$/i;

export function blogMediaUrl(id: string): string {
  return `${BLOG_MEDIA_PATH}${id}`;
}

/**
 * An image a post may show: one of our own gallery images, or an absolute
 * https URL. Never a data: URI, plain http (mixed content), or any other
 * relative path, which could point at an app route.
 */
export function isAllowedImageSrc(src: string): boolean {
  return MEDIA_URL_RE.test(src) || HTTPS_URL_RE.test(src);
}
