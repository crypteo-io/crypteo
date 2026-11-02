"use client";

import { MerchantLogo } from "@/components/checkout/MerchantLogo";
import { Logo } from "@/components/site/Logo";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiRequest } from "@/lib/api-client";
import { BrandColorPicker } from "@/components/ui/BrandColorPicker";
import { checkoutPaletteStyle, DEFAULT_SUPPORT_LINK_LABEL, PLATFORM_SUPPORT_EMAIL } from "@/lib/branding";
import { LOGO_MIN_SHARP_WIDTH_PX, LOGO_SOURCE_TYPES, sourceFileRefusal } from "@/lib/logo-crop";
import { errorMessage, toast } from "@/lib/toast";
import { ApiError } from "@/lib/api-client";
import { uploadWithProgress } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { Check, ExternalLink, ImageUp, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { ActionButton } from "./ActionButton";
import { LogoCropDialog } from "./LogoCropDialog";
import { PageHeader } from "./PageHeader";

export interface CheckoutFooter {
  supportEmail: string;
  supportLinkLabel: string;
  supportLinkUrl: string;
  showPoweredBy: boolean;
}

export function BrandingClient({
  merchantName,
  initialColor,
  initialLogoUrl,
  initialFooter,
}: {
  merchantName: string;
  initialColor: string | null;
  initialLogoUrl: string | null;
  initialFooter: CheckoutFooter;
}) {
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const [savedColor, setSavedColor] = useState(initialColor);
  const [color, setColor] = useState<string | null>(initialColor);
  const [savingColor, setSavingColor] = useState(false);
  const colorDirty = color !== savedColor;

  const [savedFooter, setSavedFooter] = useState(initialFooter);
  const [footer, setFooter] = useState(initialFooter);
  const [footerError, setFooterError] = useState<{ field?: string; message: string } | null>(null);
  const [savingFooter, setSavingFooter] = useState(false);
  const footerDirty = JSON.stringify(footer) !== JSON.stringify(savedFooter);
  const editFooter = (patch: Partial<CheckoutFooter>) => {
    setFooterError(null);
    setFooter((f) => ({ ...f, ...patch }));
  };

  const saveFooter = async () => {
    setSavingFooter(true);
    try {
      await toast.promise(
        apiRequest("/api/merchants/branding", {
          method: "PUT",
          body: {
            supportEmail: footer.supportEmail.trim() || null,
            supportLinkLabel: footer.supportLinkLabel.trim() || null,
            supportLinkUrl: footer.supportLinkUrl.trim() || null,
            showPoweredBy: footer.showPoweredBy,
          },
        }),
        { loading: "Saving footer…", success: "Checkout footer saved", error: "Footer not saved" },
      );
      setSavedFooter(footer);
    } catch (err) {
      setFooterError({ field: err instanceof ApiError ? err.field : undefined, message: errorMessage(err, "Footer not saved") });
    } finally {
      setSavingFooter(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    const refusal = sourceFileRefusal(file);
    if (refusal) {
      toast.error("Logo not uploaded", refusal);
      return;
    }
    setPendingFile(file);
  };

  const upload = async (cropped: File) => {
    setUploading(true);
    setProgress(0);
    try {
      const data = await toast.promise(uploadWithProgress<{ logo: { url: string } }>("/api/merchants/branding/logo", { logo: cropped }, setProgress), {
        loading: "Uploading logo…",
        success: "Logo updated",
        error: "Logo not uploaded",
      });
      setLogoUrl(data.logo.url);
      setPendingFile(null);
    } catch {
      // The toast already says why; the cropper stays open to try again.
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const removeLogo = async () => {
    const ok = await confirm({
      title: "Remove your logo?",
      description: "Open and new checkouts go back to showing the Crypteo mark. You can upload a logo again at any time.",
      confirmLabel: "Remove logo",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await toast.promise(
        apiRequest("/api/merchants/branding/logo", { method: "DELETE" }),
        { loading: "Removing logo…", success: "Logo removed", error: "Logo not removed" },
      );
      setLogoUrl(null);
    } catch {
      // The toast already says why.
    }
  };

  const saveColor = async () => {
    setSavingColor(true);
    try {
      await toast.promise(
        apiRequest("/api/merchants/branding", { method: "PUT", body: { brandColor: color } }),
        {
          loading: "Saving colour…",
          success: color ? "Checkout colour saved" : "Checkout colour reset",
          error: "Colour not saved",
        },
      );
      setSavedColor(color);
    } catch {
      // The toast already says why.
    } finally {
      setSavingColor(false);
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {pendingFile && (
        <LogoCropDialog
          file={pendingFile}
          uploading={uploading}
          progress={progress}
          onCancel={() => setPendingFile(null)}
          onConfirm={upload}
        />
      )}
      <PageHeader
        title="Checkout branding"
        subtitle="Your logo and colour on every hosted checkout and payment link. Changes apply to open checkouts on their next load."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-6">
          {/* ── Logo ── */}
          <section className="frame">
            <div className="frame-inner p-5 sm:p-6">
              <h2 className="font-heading text-[18px] font-semibold text-default-950">Logo</h2>
              <p className="mt-1 text-[14px] text-default-500">
                PNG, JPEG or WebP. You can crop it before it&apos;s saved. A wide logo on a transparent
                background, at least {LOGO_MIN_SHARP_WIDTH_PX}px wide, looks best.
              </p>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  onFile(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "mt-5 flex min-h-36 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-5 text-center transition-colors",
                  dragging ? "border-sky bg-sky/5" : "border-default-300 bg-default-50",
                )}
              >
                {logoUrl ? (
                  <div className="flex h-20 w-full items-center justify-center rounded-lg bg-[repeating-conic-gradient(#f1f5f9_0_25%,#ffffff_0_50%)] bg-size-[16px_16px] px-4">
                    <MerchantLogo src={logoUrl} name={merchantName} className="max-h-14 max-w-full" />
                  </div>
                ) : (
                  <span className="icon-tile size-11">
                    <ImageUp size={20} />
                  </span>
                )}
                <p className="text-[13px] text-default-500">
                  {logoUrl ? "Drop a new image here to replace it" : "Drop an image here, or"}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <ActionButton
                    type="button"
                    variant="outline"
                    className="px-4 py-2.5"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    <ImageUp size={16} /> {logoUrl ? "Replace logo" : "Choose a file"}
                  </ActionButton>
                  {logoUrl && (
                    <ActionButton
                      type="button"
                      variant="ghost"
                      className="px-4 py-2.5 hover:bg-red-50 hover:text-red-600"
                      disabled={uploading}
                      onClick={removeLogo}
                    >
                      <Trash2 size={16} /> Remove
                    </ActionButton>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={LOGO_SOURCE_TYPES.join(",")}
                  className="sr-only"
                  aria-label="Logo file"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
              </div>
            </div>
          </section>

          {/* ── Colour ── */}
          <section className="frame">
            <div className="frame-inner p-5 sm:p-6">
              <h2 className="font-heading text-[18px] font-semibold text-default-950">Theme colour</h2>
              <p className="mt-1 text-[14px] text-default-500">
                Used for buttons, the selected network and progress on your checkout.
              </p>

              <div className="mt-5">
                <BrandColorPicker color={color} onChange={setColor} />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                {colorDirty && <p className="text-[12px] text-default-500">Unsaved changes</p>}
                <ActionButton
                  type="button"
                  onClick={saveColor}
                  disabled={!colorDirty || savingColor}
                  className="px-6 py-3"
                >
                  <Save size={16} /> Save colour
                </ActionButton>
              </div>
            </div>
          </section>

          {/* ── Footer ── */}
          <section className="frame">
            <div className="frame-inner p-5 sm:p-6">
              <h2 className="font-heading text-[18px] font-semibold text-default-950">Checkout footer</h2>
              <p className="mt-1 text-[14px] text-default-500">
                Where buyers reach you for help. Leave the email empty to show {PLATFORM_SUPPORT_EMAIL}.
              </p>
              <div className="mt-5 space-y-4">
                <FooterField label="Support email" id="footer-email" error={footerError?.field === "supportEmail" ? footerError.message : undefined}>
                  <input
                    id="footer-email"
                    type="email"
                    className="field"
                    placeholder="help@yourstore.com"
                    value={footer.supportEmail}
                    onChange={(e) => editFooter({ supportEmail: e.target.value })}
                  />
                </FooterField>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                  <FooterField label="Link text" id="footer-label" error={footerError?.field === "supportLinkLabel" ? footerError.message : undefined}>
                    <input
                      id="footer-label"
                      className="field"
                      maxLength={40}
                      placeholder={DEFAULT_SUPPORT_LINK_LABEL}
                      value={footer.supportLinkLabel}
                      onChange={(e) => editFooter({ supportLinkLabel: e.target.value })}
                    />
                  </FooterField>
                  <FooterField label="Link URL" id="footer-url" error={footerError?.field === "supportLinkUrl" ? footerError.message : undefined}>
                    <input
                      id="footer-url"
                      type="url"
                      className="field"
                      placeholder="https://yourstore.com/contact"
                      value={footer.supportLinkUrl}
                      onChange={(e) => editFooter({ supportLinkUrl: e.target.value })}
                    />
                  </FooterField>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-default-200 p-3.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    checked={footer.showPoweredBy}
                    onChange={(e) => editFooter({ showPoweredBy: e.target.checked })}
                  />
                  <span className="text-[14px]">
                    <span className="block font-medium text-default-900">Show &ldquo;Powered by Crypteo&rdquo;</span>
                    <span className="text-default-500">
                      A small link under the checkout. On a fully branded checkout or your own domain, it tells buyers
                      who processes the payment.
                    </span>
                  </span>
                </label>
                {footerError && !footerError.field && <p className="text-[13px] text-accent-red">{footerError.message}</p>}
              </div>
              <div className="mt-6 flex items-center justify-end gap-3">
                {footerDirty && <p className="text-[12px] text-default-500">Unsaved changes</p>}
                <ActionButton type="button" onClick={saveFooter} disabled={!footerDirty || savingFooter} className="px-6 py-3">
                  <Save size={16} /> Save footer
                </ActionButton>
              </div>
            </div>
          </section>
        </div>

        {/* ── Quick preview ── */}
        <section className="frame self-start xl:sticky xl:top-28">
          <div className="frame-inner overflow-hidden">
            <div className="flex items-center justify-between border-b border-default-200 px-5 py-3.5">
              <h2 className="font-heading text-[15px] font-semibold text-default-950">Quick Preview</h2>
              <Link
                href="/dashboard/branding/preview"
                target="_blank"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-primary-deep"
              >
                Preview <ExternalLink size={14} />
              </Link>
            </div>
            <CheckoutPreview merchantName={merchantName} logoUrl={logoUrl} color={color} footer={footer} />
            <p className="border-t border-default-100 px-5 py-3 text-[12px] text-default-500">
              {colorDirty || footerDirty
                ? "Showing unsaved changes. The full preview shows what's saved."
                : "Preview opens the full checkout with your saved branding."}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

/** A static miniature of the hosted checkout, painted with the same tokens. */
function CheckoutPreview({
  merchantName,
  logoUrl,
  color,
  footer,
}: {
  merchantName: string;
  logoUrl: string | null;
  color: string | null;
  footer: CheckoutFooter;
}) {
  return (
    <div
      style={checkoutPaletteStyle(color)}
      className="grid bg-default-50 p-4 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] sm:gap-0 sm:p-5"
      aria-hidden
    >
      <div className="rounded-t-xl border border-default-200 bg-default-50 p-5 sm:rounded-l-xl sm:rounded-tr-none">
        <p className="text-[12px] font-medium text-default-500">Paying</p>
        <p className="font-heading text-[18px] leading-tight font-semibold break-words text-default-950">
          {merchantName}
        </p>
        <div className="mt-5 flex items-center justify-between border-t border-dashed border-default-300 pt-3 text-[13px]">
          <span className="font-semibold text-default-900">Total</span>
          <span className="font-heading font-semibold text-default-950">49.00 USD</span>
        </div>
        <div className="mt-6">
          {logoUrl ? (
            <MerchantLogo src={logoUrl} name={merchantName} className="max-h-8 max-w-[140px]" />
          ) : (
            <Logo className="gap-1.5 [&>span:last-child]:text-[14px]" markClassName="size-4" />
          )}
        </div>
      </div>

      <div className="rounded-b-xl border border-t-0 border-default-200 bg-white p-5 sm:rounded-r-xl sm:rounded-bl-none sm:border-t sm:border-l-0">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-default-500">
          <span className="flex size-4.5 items-center justify-center rounded-full bg-ck text-[10px] font-semibold text-on-ck">
            1
          </span>
          Network
          <span className="mx-1 h-px w-4 bg-default-200" />
          <span className="flex size-4.5 items-center justify-center rounded-full border border-default-200 text-[10px] text-default-400">
            2
          </span>
          Pay
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="relative rounded-lg border border-ck-ink bg-white p-2.5 ring-4 ring-ck/10">
            <p className="font-heading text-[13px] font-semibold text-default-950">USDC</p>
            <p className="text-[11px] text-default-500">on Ethereum</p>
            <span className="absolute top-2 right-2 flex size-4 items-center justify-center rounded-full bg-ck text-on-ck">
              <Check size={10} strokeWidth={3} />
            </span>
          </div>
          <div className="rounded-lg border border-default-200 bg-white p-2.5">
            <p className="font-heading text-[13px] font-semibold text-default-950">BTC</p>
            <p className="text-[11px] text-default-500">on Bitcoin</p>
          </div>
        </div>

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ck-ink/10">
          <div className="h-full w-2/3 rounded-full bg-ck-ink" />
        </div>

        <div className="mt-4 flex min-h-10 items-center justify-center rounded-lg bg-ck text-[13px] font-semibold text-on-ck">
          Continue
        </div>
        <p className="mt-3 text-center text-[11px] text-default-500">
          Need help? <span className="font-semibold break-all text-ck-ink">{footer.supportEmail.trim() || PLATFORM_SUPPORT_EMAIL}</span>
          {footer.supportLinkUrl.trim() && (
            <span className="ml-2 font-semibold text-ck-ink">{footer.supportLinkLabel.trim() || DEFAULT_SUPPORT_LINK_LABEL}</span>
          )}
        </p>
        {footer.showPoweredBy && <p className="mt-1 text-center text-[11px] text-default-400">Powered by Crypteo</p>}
      </div>
    </div>
  );
}

function FooterField({ label, id, error, children }: { label: string; id: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-default-700">
        {label}
      </label>
      {children}
      {error && <p className="mt-1.5 text-[12px] text-accent-red">{error}</p>}
    </div>
  );
}
