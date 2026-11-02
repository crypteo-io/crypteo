"use client";

import { outputSize, padBox, trimBounds, type Box } from "@/lib/logo-crop";
import { cn } from "@/lib/utils";
import { AlertTriangle, Scissors, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactCrop, { type PercentCrop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { ActionButton } from "@/components/dashboard/ActionButton";

export interface CropAspect {
  label: string;
  /** Width / height; undefined is a free crop. */
  value: number | undefined;
}

export interface CropConfig {
  title: string;
  hint: string;
  aspects: readonly CropAspect[];
  /** Largest image sent; the server re-encodes and may shrink it further. */
  outputMax: { width: number; height: number };
  /** Below this width the dialog warns the result may look soft. */
  minSharpWidth: number;
  maxUploadBytes: number;
  /** Basename for the exported file. */
  fileBase: string;
}

const FULL: PercentCrop = { unit: "%", x: 0, y: 0, width: 100, height: 100 };

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Largest crop of the given aspect, centred in the image (percent units). */
function centredAspectCrop(aspect: number, imageWidth: number, imageHeight: number): PercentCrop {
  const imageAspect = imageWidth / imageHeight;
  const width = aspect > imageAspect ? 100 : (aspect / imageAspect) * 100;
  const height = aspect > imageAspect ? (imageAspect / aspect) * 100 : 100;
  return { unit: "%", x: (100 - width) / 2, y: (100 - height) / 2, width, height };
}

/**
 * Crop step between choosing an image and uploading it (checkout logos, blog
 * gallery). The crop is rendered and downscaled in the browser
 * (lib/logo-crop.ts), so an original of many MB becomes a small file; the
 * server still re-encodes whatever arrives (lib/images.ts).
 */
export function ImageCropDialog({
  config,
  file,
  uploading,
  progress,
  onCancel,
  onConfirm,
}: {
  config: CropConfig;
  file: File;
  uploading: boolean;
  /** 0–1 while the upload is in flight. */
  progress: number | null;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [crop, setCrop] = useState<PercentCrop>(FULL);
  const [pixelCrop, setPixelCrop] = useState<Box | null>(null);
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trimmable, setTrimmable] = useState<Box | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !uploading) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, uploading]);

  const natural = () => {
    const img = imgRef.current;
    return img ? { width: img.naturalWidth, height: img.naturalHeight } : null;
  };

  /** Crop in source pixels from the percent crop (display size doesn't matter). */
  const sourceBox = (c: PercentCrop): Box | null => {
    const n = natural();
    if (!n) return null;
    return {
      x: Math.round((c.x / 100) * n.width),
      y: Math.round((c.y / 100) * n.height),
      width: Math.max(1, Math.round((c.width / 100) * n.width)),
      height: Math.max(1, Math.round((c.height / 100) * n.height)),
    };
  };

  const onImageLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setCrop(FULL);
    setPixelCrop({ x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight });
    // Read the pixels once to offer "Trim empty edges". Large originals are
    // sampled down first; the box is scaled back to source pixels.
    const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, w, h);
    const box = trimBounds(ctx.getImageData(0, 0, w, h).data, w, h);
    setTrimmable(
      box
        ? padBox(
            {
              x: Math.floor(box.x / scale),
              y: Math.floor(box.y / scale),
              width: Math.ceil(box.width / scale),
              height: Math.ceil(box.height / scale),
            },
            img.naturalWidth,
            img.naturalHeight,
          )
        : null,
    );
  };

  const applyCrop = (box: Box) => {
    const n = natural();
    if (!n) return;
    setAspect(undefined);
    const next: PercentCrop = {
      unit: "%",
      x: (box.x / n.width) * 100,
      y: (box.y / n.height) * 100,
      width: (box.width / n.width) * 100,
      height: (box.height / n.height) * 100,
    };
    setCrop(next);
    setPixelCrop(box);
  };

  const chooseAspect = (value: number | undefined) => {
    setAspect(value);
    const n = natural();
    if (!n) return;
    const next = value ? centredAspectCrop(value, n.width, n.height) : FULL;
    setCrop(next);
    setPixelCrop(sourceBox(next));
  };

  const confirm = async () => {
    const img = imgRef.current;
    const box = pixelCrop;
    if (!img || !box) return;
    setError(null);
    setRendering(true);
    try {
      const out = outputSize(box.width, box.height, config.outputMax);
      const canvas = document.createElement("canvas");
      canvas.width = out.width;
      canvas.height = out.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, out.width, out.height);

      // PNG keeps transparency losslessly; a busy photo-like logo that comes
      // out over the cap falls back to WebP, which also keeps alpha.
      let blob = await toBlob(canvas, "image/png");
      let name = `${config.fileBase}.png`;
      if (!blob || blob.size > config.maxUploadBytes) {
        blob = await toBlob(canvas, "image/webp", 0.92);
        name = `${config.fileBase}.webp`;
      }
      if (!blob || blob.size > config.maxUploadBytes) {
        setError(
          `This crop is still over ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB. Crop tighter or use a simpler image.`,
        );
        return;
      }
      onConfirm(new File([blob], name, { type: blob.type }));
    } catch {
      setError("Your browser couldn't process this image. Try a PNG or JPEG export.");
    } finally {
      setRendering(false);
    }
  };

  const out = pixelCrop ? outputSize(pixelCrop.width, pixelCrop.height, config.outputMax) : null;
  const tooSmall = pixelCrop !== null && pixelCrop.width < config.minSharpWidth;
  const busy = rendering || uploading;

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-default-950/40 backdrop-blur-sm animate-[confirm-fade-in_150ms_ease-out]"
        onClick={busy ? undefined : onCancel}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-crop-title"
        tabIndex={-1}
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-default-200 bg-white shadow-card-hover outline-none animate-[confirm-pop-in_180ms_ease-out]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-default-200 px-5 py-4 sm:px-6">
          <div>
            <h2 id="image-crop-title" className="font-heading text-[18px] font-semibold text-default-950">
              {config.title}
            </h2>
            <p className="mt-0.5 text-[13px] text-default-500">{config.hint}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-2 text-default-400 transition-colors hover:bg-default-100 hover:text-default-900 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl border border-default-200 bg-default-50 p-1" role="group" aria-label="Crop shape">
              {config.aspects.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => chooseAspect(a.value)}
                  aria-pressed={aspect === a.value}
                  disabled={busy || !src || loadError}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
                    aspect === a.value
                      ? "bg-white text-default-950 shadow-premium"
                      : "text-default-500 hover:text-default-900",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {trimmable && (
              <button
                type="button"
                onClick={() => applyCrop(trimmable)}
                disabled={busy}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-sky hover:underline"
              >
                <Scissors size={14} /> Trim empty edges
              </button>
            )}
          </div>

          <div className="mt-4 flex min-h-48 items-center justify-center rounded-xl border border-default-200 bg-[repeating-conic-gradient(#f1f5f9_0_25%,#ffffff_0_50%)] bg-size-[16px_16px] p-3">
            {loadError ? (
              <p className="px-4 py-10 text-center text-[14px] text-default-600">
                This file couldn&apos;t be opened as an image. Try exporting it again as a PNG.
              </p>
            ) : (
              src && (
                <ReactCrop
                  crop={crop}
                  aspect={aspect}
                  keepSelection
                  minWidth={16}
                  minHeight={16}
                  disabled={busy}
                  onChange={(_: PixelCrop, percent: PercentCrop) => setCrop(percent)}
                  onComplete={(_: PixelCrop, percent: PercentCrop) => setPixelCrop(sourceBox(percent))}
                  className="max-h-[50dvh]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={imgRef}
                    src={src}
                    alt="Image to crop"
                    onLoad={onImageLoad}
                    onError={() => setLoadError(true)}
                    className="block max-h-[50dvh] w-auto max-w-full"
                  />
                </ReactCrop>
              )
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-default-500">
            <span>
              {pixelCrop && out
                ? `Selection ${pixelCrop.width}×${pixelCrop.height}px, saved as ${out.width}×${out.height}px`
                : "Loading image…"}
            </span>
            <span>
              Original {(file.size / 1024 / 1024).toFixed(file.size > 1024 * 1024 ? 1 : 2)} MB
            </span>
          </div>

          {tooSmall && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-accent-orange/25 bg-accent-orange/5 p-3 text-[13px] text-default-700">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-accent-orange" />
              This selection is under {config.minSharpWidth}px wide, so it may look soft on high-resolution screens. A larger original works better.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-default-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-h-5 flex-1">
            {uploading && (
              <div className="flex items-center gap-3" aria-live="polite">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-default-100">
                  <div
                    className="h-full rounded-full bg-sky transition-[width] duration-200"
                    style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
                  />
                </div>
                <span className="w-24 text-right text-[12px] font-medium text-default-500">
                  {progress !== null && progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Processing…"}
                </span>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <ActionButton type="button" variant="outline" onClick={onCancel} disabled={busy} className="px-5 py-2.5">
              Cancel
            </ActionButton>
            <ActionButton
              type="button"
              onClick={confirm}
              disabled={busy || !pixelCrop || loadError}
              className="px-5 py-2.5"
            >
              {uploading ? "Uploading…" : rendering ? "Preparing…" : "Save image"}
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  );
}
