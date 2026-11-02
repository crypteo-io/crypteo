import { describe, expect, it } from "vitest";
import { renderHtml, renderPost } from "./markdown";
import { isAllowedImageSrc } from "./media";

const MEDIA = "/api/blog-media/cmedia000000000000000001";

// The rich-text editor's HTML reaches the server as whatever the client sent.
// The sanitiser, not the editor's schema, is the defence.
describe("renderHtml", () => {
  it("keeps the editor's formatting", () => {
    const html = renderHtml(
      '<h2>Title</h2><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s></p><ul><li><p>one</p></li></ul><blockquote><p>q</p></blockquote><pre><code>x</code></pre><hr>',
    );
    for (const tag of ["<h2>", "<strong>", "<em>", "<u>", "<s>", "<ul>", "<blockquote>", "<pre>", "<hr />"]) {
      expect(html).toContain(tag);
    }
  });

  it("strips script, event handlers, styles and iframes", () => {
    const html = renderHtml(
      '<p onclick="x()" style="color:red">a</p><script>alert(1)</script><iframe src="https://evil.example"></iframe><img src="https://a.example/i.png" onerror="x()">',
    );
    expect(html).not.toMatch(/script|onclick|onerror|style=|iframe/);
    expect(html).toContain('<img src="https://a.example/i.png" />');
  });

  it("refuses javascript:, data: and vbscript: links", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x"]) {
      expect(renderHtml(`<p><a href="${href}">x</a></p>`)).not.toContain(href.split(":")[0] + ":");
    }
  });

  it("marks external links nofollow and drops target", () => {
    const html = renderHtml('<p><a href="https://x.example" target="_blank">x</a></p>');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain("target");
  });

  it("allows gallery images and https images only", () => {
    expect(renderHtml(`<img src="${MEDIA}" alt="a">`)).toContain(`src="${MEDIA}"`);
    for (const src of ["data:image/png;base64,AAAA", "http://a.example/i.png", "/api/payments/x", "//evil.example/i.png"]) {
      expect(renderHtml(`<img src="${src}">`)).not.toContain("<img");
    }
  });
});

describe("renderPost", () => {
  it("renders Markdown posts through marked and HTML posts as-is, both sanitised", () => {
    expect(renderPost({ content: "## Hi", format: "markdown" })).toContain("<h2>Hi</h2>");
    expect(renderPost({ content: "## Hi", format: "html" })).toBe("## Hi");
    expect(renderPost({ content: "<script>x</script><p>ok</p>", format: "html" })).toBe("<p>ok</p>");
  });
});

describe("media rules", () => {
  it("accepts only our gallery path or absolute https", () => {
    expect(isAllowedImageSrc(MEDIA)).toBe(true);
    expect(isAllowedImageSrc("https://cdn.example/a.png")).toBe(true);
    expect(isAllowedImageSrc(`${MEDIA}/../../admin`)).toBe(false);
    expect(isAllowedImageSrc("/api/blog-media/short")).toBe(false);
  });

});
