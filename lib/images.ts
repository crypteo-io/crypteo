import sharp from "sharp";

// Decompression-bomb ceiling: a tiny file can declare a gigapixel canvas.
const MAX_INPUT_PIXELS = 25_000_000;

// SVG is refused on purpose: it is a document that can carry script, and the
// raster formats below cover every image an admin or merchant exports.
const ACCEPTED_FORMATS = new Set(["png", "jpeg", "webp"]);

export type ProcessedImage =
  | { ok: true; data: Buffer; contentType: string; width: number; height: number }
  | { ok: false; error: string };

export interface ImageLimits {
  maxUploadBytes: number;
  maxWidthPx: number;
  maxHeightPx: number;
  /** "Logo", "Image": used in the error text. */
  noun: string;
}

/**
 * Decode and re-encode an uploaded image. The stored bytes are always sharp's
 * own WebP output, never what was uploaded, so whatever rode along in the
 * original file (metadata, polyglot payloads, a mislabelled type) is gone.
 * The format is sniffed from the content, not from the name or MIME type.
 * Shared by checkout logos (lib/branding-logo.ts) and the blog gallery.
 */
export async function processImage(input: Buffer, limits: ImageLimits): Promise<ProcessedImage> {
  const unreadable = { ok: false as const, error: "That file isn't an image we can read" };
  if (input.length === 0) return { ok: false, error: "The file is empty" };
  if (input.length > limits.maxUploadBytes) {
    return {
      ok: false,
      error: `${limits.noun} must be ${Math.round(limits.maxUploadBytes / 1024 / 1024)} MB or smaller`,
    };
  }

  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
  } catch {
    return unreadable;
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) {
    return { ok: false, error: "Upload a PNG, JPEG or WebP image" };
  }

  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .resize({
        width: limits.maxWidthPx,
        height: limits.maxHeightPx,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 88, alphaQuality: 100, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, data, contentType: "image/webp", width: info.width, height: info.height };
  } catch {
    return unreadable;
  }
}
