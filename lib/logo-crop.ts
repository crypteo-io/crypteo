// Pure helpers for the logo cropper (components/dashboard/LogoCropDialog.tsx).
// Browser-only APIs stay in the component so these can be unit-tested.

/** Originals are decoded in the browser, so this can be far above the upload cap. */
export const LOGO_SOURCE_MAX_BYTES = 15 * 1024 * 1024;
export const LOGO_SOURCE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
// Sent at twice the size the server stores (480x160), so its downscale has
// detail to work from; anything bigger is only upload time.
export const LOGO_OUTPUT_MAX_WIDTH_PX = 960;
export const LOGO_OUTPUT_MAX_HEIGHT_PX = 320;
/** Below this the checkout (up to 220 css px wide at 2x) draws it blurry. */
export const LOGO_MIN_SHARP_WIDTH_PX = 240;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Why a chosen file can't go to the cropper, or null. */
export function sourceFileRefusal(file: { type: string; size: number }): string | null {
  if (file.type === "image/svg+xml") {
    return "SVG isn't supported. Export your logo as a PNG with a transparent background.";
  }
  if (!(LOGO_SOURCE_TYPES as readonly string[]).includes(file.type)) {
    return "Choose a PNG, JPEG or WebP image.";
  }
  if (file.size > LOGO_SOURCE_MAX_BYTES) {
    return `That image is over ${LOGO_SOURCE_MAX_BYTES / 1024 / 1024} MB. Choose a smaller file.`;
  }
  return null;
}

/** Size of the uploaded image for a crop of `width` x `height` source pixels. Never enlarges. */
export function outputSize(
  width: number,
  height: number,
  max: { width: number; height: number } = { width: LOGO_OUTPUT_MAX_WIDTH_PX, height: LOGO_OUTPUT_MAX_HEIGHT_PX },
): { width: number; height: number } {
  const scale = Math.min(1, max.width / width, max.height / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// Channel distance under which a pixel counts as the background colour (JPEG
// noise around a white margin), and the alpha at or below which it's empty.
const COLOR_TOLERANCE = 24;
const ALPHA_EMPTY = 8;

/**
 * The bounding box of the logo inside its empty margin: transparent pixels
 * when the image has an alpha border, otherwise pixels matching the corner
 * colour when all four corners agree (a white or coloured canvas). Null when
 * there is no margin to trim or the image is blank.
 */
export function trimBounds(data: Uint8ClampedArray, width: number, height: number): Box | null {
  const at = (x: number, y: number) => (y * width + x) * 4;
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  const transparent = corners.every((i) => data[i + 3] <= ALPHA_EMPTY);

  const [r0, g0, b0] = [data[corners[0]], data[corners[0] + 1], data[corners[0] + 2]];
  const near = (i: number) =>
    Math.abs(data[i] - r0) <= COLOR_TOLERANCE &&
    Math.abs(data[i + 1] - g0) <= COLOR_TOLERANCE &&
    Math.abs(data[i + 2] - b0) <= COLOR_TOLERANCE;
  const solid = !transparent && corners.every((i) => data[i + 3] > ALPHA_EMPTY && near(i));
  if (!transparent && !solid) return null;

  const isBackground = (i: number) => data[i + 3] <= ALPHA_EMPTY || (solid && near(i));

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isBackground(at(x, y))) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  const box = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  if (box.width === width && box.height === height) return null;
  return box;
}

/** Grow a box by `ratio` of its larger side on each edge, inside the image. */
export function padBox(box: Box, imageWidth: number, imageHeight: number, ratio = 0.04): Box {
  const pad = Math.round(Math.max(box.width, box.height) * ratio);
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return {
    x,
    y,
    width: Math.min(imageWidth, box.x + box.width + pad) - x,
    height: Math.min(imageHeight, box.y + box.height + pad) - y,
  };
}
