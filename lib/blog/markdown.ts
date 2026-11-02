import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { isAllowedImageSrc } from "./media";

// Our own instance: marked's global defaults are shared process-wide.
const marked = new Marked({ gfm: true, breaks: false });

const EXTERNAL_REL = "noopener noreferrer nofollow";
const TABLE_WRAPPER_CLASS = "prose-table";

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "ul", "ol", "li",
    "a", "img",
    "strong", "em", "b", "i", "u", "del", "s",
    "code", "pre", "blockquote",
    "table", "thead", "tbody", "tr", "th", "td",
    "div",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel"],
    img: ["src", "alt", "title"],
    th: ["align"],
    td: ["align"],
    code: ["class"],
    div: ["class"],
  },
  allowedClasses: {
    code: ["language-*"],
    div: [TABLE_WRAPPER_CLASS],
  },
  allowedSchemes: ["http", "https", "mailto"],
  // img src is checked by exclusiveFilter below (https or our own gallery).
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    // The page already has the post title as its h1.
    h1: "h2",
    a: (tagName, attribs) => {
      const href = attribs.href ?? "";
      const next: sanitizeHtml.Attributes = { href };
      if (attribs.title) next.title = attribs.title;
      if (/^https?:\/\//i.test(href)) next.rel = EXTERNAL_REL;
      return { tagName, attribs: next };
    },
  },
  // Only absolute https images or our own gallery (lib/blog/media.ts): no
  // data: URIs, no http (mixed content), no other relative path.
  exclusiveFilter: (frame) => frame.tag === "img" && !isAllowedImageSrc(frame.attribs.src ?? ""),
};

/**
 * Admin-written Markdown as HTML that is safe to inject. Every rendering of a
 * post, the public page and the editor preview alike, goes through here, so
 * what the admin previews is exactly what readers get.
 */
export function renderMarkdown(markdown: string): string {
  return renderHtml(marked.parse(markdown, { async: false }));
}

/**
 * HTML from the rich-text editor (or rendered Markdown), through the same
 * allow-list. The editor's own schema is a convenience, never the defence:
 * the request body is whatever the client sent.
 */
export function renderHtml(html: string): string {
  // Wide tables scroll inside their own box instead of the whole page.
  const wrapped = html
    .replace(/<table>/g, `<div class="${TABLE_WRAPPER_CLASS}"><table>`)
    .replace(/<\/table>/g, "</table></div>");
  return sanitizeHtml(wrapped, SANITIZE).trim();
}

export type PostFormat = "html" | "markdown";

/** A stored post body, in either format, as safe HTML. */
export function renderPost(post: { content: string; format: string }): string {
  return post.format === "html" ? renderHtml(post.content) : renderMarkdown(post.content);
}
