"use client";

import { ActionButton } from "@/components/dashboard/ActionButton";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ImageCropDialog, type CropConfig } from "@/components/ui/ImageCropDialog";
import { apiRequest } from "@/lib/api-client";
import {
  BLOG_MEDIA_MAX_HEIGHT_PX,
  BLOG_MEDIA_MAX_UPLOAD_BYTES,
  BLOG_MEDIA_MAX_WIDTH_PX,
  MAX_ALT_LENGTH,
} from "@/lib/blog/media";
import { LOGO_SOURCE_TYPES, sourceFileRefusal } from "@/lib/logo-crop";
import { errorMessage, toast } from "@/lib/toast";
import { uploadWithProgress } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { ImagePlus, ImageUp, Loader2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface MediaItem {
  id: string;
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
  alt: string | null;
  createdAt: string;
}

const BLOG_CROP: CropConfig = {
  title: "Crop the image",
  hint: "Frame the part you want in the post. Free shape keeps the whole image.",
  aspects: [
    { label: "Free", value: undefined },
    { label: "16:9", value: 16 / 9 },
    { label: "4:3", value: 4 / 3 },
    { label: "Square", value: 1 },
  ],
  outputMax: { width: BLOG_MEDIA_MAX_WIDTH_PX, height: BLOG_MEDIA_MAX_HEIGHT_PX },
  minSharpWidth: 800,
  maxUploadBytes: BLOG_MEDIA_MAX_UPLOAD_BYTES,
  fileBase: "image",
};

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; media: MediaItem[] };

/**
 * The blog image gallery: pick an uploaded image (with its alt text) or
 * upload a new one through the same crop step as checkout logos. Images are
 * re-encoded on the server and served from /api/blog-media/<id>.
 */
export function MediaGallery({
  open,
  title,
  selectLabel,
  onClose,
  onSelect,
}: {
  open: boolean;
  title: string;
  selectLabel: string;
  onClose: () => void;
  onSelect: (image: { url: string; alt: string }) => void;
}) {
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [alt, setAlt] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const { media } = await apiRequest<{ media: MediaItem[] }>("/api/admin/blog/media");
      setLoad({ state: "ready", media });
    } catch (err) {
      setLoad({ state: "error", message: errorMessage(err, "The gallery didn't load.") });
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pendingFile) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pendingFile, onClose]);

  if (!open) return null;

  const media = load.state === "ready" ? load.media : [];
  const selected = media.find((m) => m.id === selectedId) ?? null;

  const select = (item: MediaItem) => {
    setSelectedId(item.id);
    setAlt(item.alt ?? "");
  };

  const onFile = (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    const refusal = sourceFileRefusal(file);
    if (refusal) {
      toast.error("Image not uploaded", refusal);
      return;
    }
    setPendingFile(file);
  };

  const upload = async (cropped: File) => {
    setUploading(true);
    setProgress(0);
    try {
      const { media: created } = await toast.promise(
        uploadWithProgress<{ media: MediaItem }>("/api/admin/blog/media", { image: cropped }, setProgress),
        { loading: "Uploading image…", success: "Image uploaded", error: "Image not uploaded" },
      );
      setPendingFile(null);
      setLoad((prev) => (prev.state === "ready" ? { state: "ready", media: [created, ...prev.media] } : prev));
      select(created);
    } catch {
      // The toast already says why; the cropper stays open to try again.
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const remove = async (item: MediaItem) => {
    const ok = await confirm({
      title: "Delete this image?",
      description: "It's removed from the gallery for good. Images still used in a post can't be deleted.",
      confirmLabel: "Delete image",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await toast.promise(apiRequest(`/api/admin/blog/media/${item.id}`, { method: "DELETE" }), {
        loading: "Deleting image…",
        success: "Image deleted",
        error: "Image not deleted",
      });
      setSelectedId(null);
      setLoad((prev) =>
        prev.state === "ready" ? { state: "ready", media: prev.media.filter((m) => m.id !== item.id) } : prev,
      );
    } catch {
      // The toast already says why (e.g. still used in a post).
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-150 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-default-950/40 backdrop-blur-sm animate-[confirm-fade-in_150ms_ease-out]"
          onClick={onClose}
          aria-hidden
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="media-gallery-title"
          className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-default-200 bg-white shadow-card-hover animate-[confirm-pop-in_180ms_ease-out]"
        >
          <div className="flex items-center justify-between gap-4 border-b border-default-200 px-5 py-4 sm:px-6">
            <div>
              <h2 id="media-gallery-title" className="font-heading text-[18px] font-semibold text-default-950">
                {title}
              </h2>
              <p className="mt-0.5 text-[13px] text-default-500">
                PNG, JPEG or WebP. Uploads are cropped, resized and re-encoded before they&apos;re stored.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ActionButton type="button" className="px-4 py-2.5" onClick={() => fileRef.current?.click()}>
                <ImageUp size={16} /> Upload
              </ActionButton>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close gallery"
                className="rounded-lg p-2 text-default-400 transition-colors hover:bg-default-100 hover:text-default-900"
              >
                <X size={18} />
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={LOGO_SOURCE_TYPES.join(",")}
              className="sr-only"
              aria-label="Image file"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {load.state === "loading" && (
              <div className="flex h-48 items-center justify-center text-default-400">
                <Loader2 className="animate-spin" size={22} />
              </div>
            )}
            {load.state === "error" && (
              <div className="flex h-48 flex-col items-center justify-center gap-3 text-center">
                <p className="text-[14px] text-default-600">{load.message}</p>
                <ActionButton type="button" variant="outline" className="px-4 py-2" onClick={refresh}>
                  Try again
                </ActionButton>
              </div>
            )}
            {load.state === "ready" && media.length === 0 && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-48 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-default-300 bg-default-50 text-default-500 hover:bg-default-100"
              >
                <ImagePlus size={26} />
                <span className="text-[14px] font-medium">No images yet. Upload the first one.</span>
              </button>
            )}
            {media.length > 0 && (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {media.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => select(item)}
                      aria-pressed={item.id === selectedId}
                      className={cn(
                        "group relative block aspect-4/3 w-full overflow-hidden rounded-xl border bg-[repeating-conic-gradient(#f1f5f9_0_25%,#ffffff_0_50%)] bg-size-[16px_16px] transition-shadow",
                        item.id === selectedId
                          ? "border-sky ring-4 ring-sky/15"
                          : "border-default-200 hover:border-default-300",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={item.alt ?? ""}
                        loading="lazy"
                        className="size-full object-contain"
                      />
                      <span className="absolute bottom-1.5 left-1.5 rounded-md bg-default-950/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
                        {item.width}×{item.height}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-default-200 px-5 py-4 sm:flex-row sm:items-end sm:px-6">
            <div className="min-w-0 flex-1">
              <label htmlFor="media-alt" className="mb-1.5 block text-[13px] font-medium text-default-700">
                Alt text <span className="font-normal text-default-500">(describes the image for screen readers and search)</span>
              </label>
              <input
                id="media-alt"
                value={alt}
                maxLength={MAX_ALT_LENGTH}
                onChange={(e) => setAlt(e.target.value)}
                disabled={!selected}
                placeholder={selected ? "e.g. Checkout page showing the QR code" : "Select an image first"}
                className="field h-11 text-[14px]"
              />
            </div>
            <div className="flex shrink-0 gap-2">
              {selected && (
                <ActionButton
                  type="button"
                  variant="ghost"
                  className="px-3 py-2.5 hover:bg-red-50 hover:text-red-600"
                  onClick={() => remove(selected)}
                  aria-label="Delete selected image"
                >
                  <Trash2 size={16} />
                </ActionButton>
              )}
              <ActionButton
                type="button"
                disabled={!selected}
                className="px-5 py-2.5"
                onClick={() => selected && onSelect({ url: selected.url, alt: alt.trim() })}
              >
                {selectLabel}
              </ActionButton>
            </div>
          </div>
        </div>
      </div>

      {pendingFile && (
        <ImageCropDialog
          config={BLOG_CROP}
          file={pendingFile}
          uploading={uploading}
          progress={progress}
          onCancel={() => setPendingFile(null)}
          onConfirm={upload}
        />
      )}
    </>
  );
}
