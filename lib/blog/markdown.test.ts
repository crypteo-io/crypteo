import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders the everyday Markdown an article needs", () => {
    const html = renderMarkdown(
      [
        "## Heading",
        "",
        "Some **bold**, *em* and `code`.",
        "",
        "- one",
        "- two",
        "",
        "> quoted",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "---",
      ].join("\n"),
    );
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain("<hr />");
  });

  it("demotes h1, which the page's title already is", () => {
    expect(renderMarkdown("# Title")).toBe("<h2>Title</h2>");
  });

  it("strips script tags and their contents", () => {
    const html = renderMarkdown('Hello <script>alert("x")</script> world');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
  });

  it("strips inline event handlers", () => {
    const html = renderMarkdown('<img src="https://x.co/a.png" onerror="alert(1)"> <a href="https://x.co" onclick="alert(2)">x</a>');
    expect(html).not.toMatch(/onerror|onclick|alert/);
    expect(html).toContain('src="https://x.co/a.png"');
  });

  it("strips javascript: URLs, however they're written", () => {
    for (const md of [
      "[click](javascript:alert(1))",
      '<a href="javascript:alert(1)">click</a>',
      '<a href="JaVaScRiPt:alert(1)">click</a>',
      '<a href="&#106;avascript:alert(1)">click</a>',
    ]) {
      const html = renderMarkdown(md);
      expect(html, md).not.toMatch(/javascript/i);
      expect(html, md).not.toContain("alert");
    }
  });

  it("drops iframes, styles, forms and other tags outside the allow-list", () => {
    const html = renderMarkdown(
      '<iframe src="https://evil.example"></iframe><style>body{}</style><form><input></form><div style="x" class="evil">t</div>',
    );
    expect(html).not.toMatch(/iframe|style|form|input|evil/);
  });

  it("marks external links nofollow and keeps internal ones plain", () => {
    expect(renderMarkdown("[a](https://example.com)")).toBe(
      '<p><a href="https://example.com" rel="noopener noreferrer nofollow">a</a></p>',
    );
    expect(renderMarkdown("[b](/register)")).toBe('<p><a href="/register">b</a></p>');
    expect(renderMarkdown("[c](mailto:hi@crypteo.io)")).toBe(
      '<p><a href="mailto:hi@crypteo.io">c</a></p>',
    );
  });

  it("ignores a rel the author wrote", () => {
    expect(renderMarkdown('<a href="/x" rel="opener">x</a>')).not.toContain("opener");
  });

  it("keeps only https images", () => {
    expect(renderMarkdown("![ok](https://cdn.example/a.png)")).toContain('src="https://cdn.example/a.png"');
    for (const src of ["http://cdn.example/a.png", "data:image/png;base64,AAAA", "/api/admin/blog", "//cdn.example/a.png"]) {
      expect(renderMarkdown(`![x](${src})`), src).not.toContain("<img");
    }
  });

  it("wraps tables so they scroll on their own", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toMatch(/^<div class="prose-table"><table>/);
    expect(html).toContain("<td>1</td>");
  });
});
