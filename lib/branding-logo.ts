import { LOGO_MAX_UPLOAD_BYTES } from "./branding";
import { processImage, type ProcessedImage } from "./images";

export { LOGO_MAX_UPLOAD_BYTES };

// Stored at 2x the largest size the checkout draws it (about 220x56 css px).
const LOGO_MAX_WIDTH_PX = 480;
const LOGO_MAX_HEIGHT_PX = 160;

export type ProcessedLogo = ProcessedImage;

/** A checkout logo, re-encoded by the shared image pipeline (lib/images.ts). */
export function processLogo(input: Buffer): Promise<ProcessedLogo> {
  return processImage(input, {
    maxUploadBytes: LOGO_MAX_UPLOAD_BYTES,
    maxWidthPx: LOGO_MAX_WIDTH_PX,
    maxHeightPx: LOGO_MAX_HEIGHT_PX,
    noun: "Logo",
  });
}
