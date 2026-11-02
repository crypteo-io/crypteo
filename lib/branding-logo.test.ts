import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LOGO_MAX_UPLOAD_BYTES, processLogo } from "./branding-logo";

function png(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 19, g: 92, b: 164, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
}

describe("processLogo", () => {
  it("re-encodes to WebP and keeps transparency", async () => {
    const out = await processLogo(await png(200, 80));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.contentType).toBe("image/webp");
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.hasAlpha).toBe(true);
  });

  it("shrinks a large logo to fit 480x160 and never enlarges a small one", async () => {
    const big = await processLogo(await png(2400, 600));
    expect(big.ok && [big.width, big.height]).toEqual([480, 120]);
    const small = await processLogo(await png(120, 40));
    expect(small.ok && [small.width, small.height]).toEqual([120, 40]);
  });

  it("refuses SVG, whatever the upload claimed to be", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    );
    expect(await processLogo(svg)).toEqual({ ok: false, error: "Upload a PNG, JPEG or WebP image" });
  });

  it("refuses non-images, empty files and oversized uploads", async () => {
    expect((await processLogo(Buffer.from("hello"))).ok).toBe(false);
    expect((await processLogo(Buffer.alloc(0))).ok).toBe(false);
    expect((await processLogo(Buffer.alloc(LOGO_MAX_UPLOAD_BYTES + 1))).ok).toBe(false);
  });
});
