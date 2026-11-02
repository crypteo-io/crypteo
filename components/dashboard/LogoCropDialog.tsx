"use client";

import { ImageCropDialog, type CropConfig } from "@/components/ui/ImageCropDialog";
import { LOGO_MAX_UPLOAD_BYTES } from "@/lib/branding";
import { LOGO_MIN_SHARP_WIDTH_PX, LOGO_OUTPUT_MAX_HEIGHT_PX, LOGO_OUTPUT_MAX_WIDTH_PX } from "@/lib/logo-crop";

const LOGO_CROP: CropConfig = {
  title: "Crop your logo",
  hint: "Drag the corners to frame it. Keep a little space around the edges.",
  aspects: [
    { label: "Free", value: undefined },
    { label: "Wide 3:1", value: 3 },
    { label: "Square", value: 1 },
  ],
  outputMax: { width: LOGO_OUTPUT_MAX_WIDTH_PX, height: LOGO_OUTPUT_MAX_HEIGHT_PX },
  minSharpWidth: LOGO_MIN_SHARP_WIDTH_PX,
  maxUploadBytes: LOGO_MAX_UPLOAD_BYTES,
  fileBase: "logo",
};

/** The checkout logo's crop step (components/ui/ImageCropDialog.tsx). */
export function LogoCropDialog(props: Omit<Parameters<typeof ImageCropDialog>[0], "config">) {
  return <ImageCropDialog config={LOGO_CROP} {...props} />;
}
