"use client";

import { DemoCheckout } from "@/components/checkout/DemoCheckout";
import { MerchantLogo } from "@/components/checkout/MerchantLogo";
import { LogoCropDialog } from "@/components/dashboard/LogoCropDialog";
import { ButtonLink } from "@/components/site/Button";
import { PageHero } from "@/components/site/PageHero";
import SiteShell from "@/components/site/SiteShell";
import { BrandColorPicker } from "@/components/ui/BrandColorPicker";
import { useIsClient } from "@/components/ui/useIsClient";
import {
  clampDemoAmount,
  DEFAULT_DEMO_SETTINGS,
  DEMO_LIMITS,
  DEMO_STORAGE_KEY,
  isDemoLogo,
  parseDemoSettings,
  type DemoSettings,
} from "@/lib/checkout-demo";
import { LOGO_SOURCE_TYPES, sourceFileRefusal } from "@/lib/logo-crop";
import { toast } from "@/lib/toast";
import { HardDrive, ImageUp, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

function loadSettings(): DemoSettings {
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    return raw ? parseDemoSettings(JSON.parse(raw)) : { ...DEFAULT_DEMO_SETTINGS };
  } catch {
    return { ...DEFAULT_DEMO_SETTINGS };
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("unreadable")));
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
    reader.readAsDataURL(file);
  });
}

export default function CheckoutDemoClient() {
  const isClient = useIsClient();
  return (
    <SiteShell>
      <PageHero
        eyebrow={
          <span className="eyebrow">
            <HardDrive size={16} className="text-sky" />
            Runs only in your browser
          </span>
        }
        title="Try the checkout"
        subtitle="Put your store's name, logo and colour on the hosted checkout, then pay as a buyer would. Nothing you enter or upload leaves this browser."
      />
      <section className="container-site pb-10">
        {/* Settings live in localStorage, so the demo renders after mount:
            the server can't know them, and the session clock is the browser's. */}
        {isClient ? <Demo /> : <div className="frame h-[640px]" aria-hidden />}
        <div className="mt-16 text-center">
          <h2 className="text-[30px] md:text-[40px]">Ready to take real payments?</h2>
          <p className="mx-auto mt-3 max-w-xl text-lg text-default-600">
            Set your logo and colour once in the dashboard and every checkout and payment link uses them.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-4">
            <ButtonLink href="/register">Create an account</ButtonLink>
            <ButtonLink href="/docs" variant="white">
              Read the API docs
            </ButtonLink>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}

function Demo() {
  const [settings, setSettings] = useState<DemoSettings>(loadSettings);
  const [amountDraft, setAmountDraft] = useState(String(settings.amountUsd));
  const [runKey, setRunKey] = useState(0);
  // Remounts the colour picker on "Clear my settings", dropping its hex draft.
  const [generation, setGeneration] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Private windows and full storage: the demo still works for this visit.
    }
  }, [settings]);

  const update = (patch: Partial<DemoSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const restart = () => setRunKey((k) => k + 1);

  const onFile = (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    const refusal = sourceFileRefusal(file);
    if (refusal) {
      toast.error("Logo not added", refusal);
      return;
    }
    setPendingFile(file);
  };

  const takeCropped = async (cropped: File) => {
    try {
      const url = await readAsDataUrl(cropped);
      if (!isDemoLogo(url)) throw new Error("That crop is too large for the demo. Crop tighter or use a simpler image.");
      update({ logo: url });
      setPendingFile(null);
    } catch (error) {
      toast.error("Logo not added", error instanceof Error ? error.message : undefined);
    }
  };

  const reset = () => {
    setSettings({ ...DEFAULT_DEMO_SETTINGS });
    setGeneration((g) => g + 1);
    setAmountDraft(String(DEFAULT_DEMO_SETTINGS.amountUsd));
    restart();
  };

  const merchantName = settings.name.trim() || null;

  return (
    <div className="space-y-8">
      {pendingFile && (
        <LogoCropDialog
          file={pendingFile}
          uploading={false}
          progress={null}
          onCancel={() => setPendingFile(null)}
          onConfirm={takeCropped}
        />
      )}

      <section className="frame">
        <div className="frame-inner p-5 sm:p-7">
          <div className="mb-6 flex flex-col gap-4 border-b border-default-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[22px]">Your checkout</h2>
              <p className="mt-1 text-[14px] text-default-500">Saved in this browser only, so it&apos;s here when you come back.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={restart}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-medium text-white hover:bg-primary-deep"
              >
                <RotateCcw size={15} /> Restart checkout
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex min-h-11 items-center rounded-xl px-3 text-[14px] font-medium text-default-600 hover:bg-default-50 hover:text-default-950"
              >
                Clear my settings
              </button>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
            <div className="space-y-5">
              <Field label="Store name" id="demo-name">
                <input
                  id="demo-name"
                  className="field"
                  value={settings.name}
                  maxLength={DEMO_LIMITS.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </Field>
              <Field label="Order title" id="demo-title" hint="What a payment link would sell. Leave empty for a plain checkout.">
                <input
                  id="demo-title"
                  className="field"
                  value={settings.title}
                  maxLength={DEMO_LIMITS.title}
                  onChange={(e) => update({ title: e.target.value })}
                />
              </Field>
              {settings.title.trim() && (
                <Field label="Description" id="demo-description">
                  <textarea
                    id="demo-description"
                    className="field h-auto min-h-20 py-3"
                    value={settings.description}
                    maxLength={DEMO_LIMITS.description}
                    onChange={(e) => update({ description: e.target.value })}
                  />
                </Field>
              )}
            </div>
            <div className="space-y-5">
              <Field label="Price (USD)" id="demo-amount" hint="Changing it restarts the payment step.">
                <input
                  id="demo-amount"
                  className="field tabular-nums"
                  inputMode="decimal"
                  value={amountDraft}
                  onChange={(e) => setAmountDraft(e.target.value)}
                  onBlur={() => {
                    const amountUsd = clampDemoAmount(amountDraft, settings.amountUsd);
                    setAmountDraft(String(amountUsd));
                    update({ amountUsd });
                  }}
                />
              </Field>
              <Field label="Logo" hint="PNG, JPEG or WebP. Cropped here, kept in this browser.">
                <div className="flex flex-wrap items-center gap-3">
                  {settings.logo && (
                    <div className="flex h-14 max-w-full items-center rounded-lg bg-[repeating-conic-gradient(#f1f5f9_0_25%,#ffffff_0_50%)] bg-size-[16px_16px] px-3">
                      <MerchantLogo src={settings.logo} name={merchantName} className="max-h-10 max-w-[180px]" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-default-200 bg-white px-4 text-[14px] font-medium text-default-900 hover:bg-default-50"
                  >
                    <ImageUp size={16} /> {settings.logo ? "Replace" : "Add a logo"}
                  </button>
                  {settings.logo && (
                    <button
                      type="button"
                      onClick={() => update({ logo: null })}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-[14px] font-medium text-default-600 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={16} /> Remove
                    </button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept={LOGO_SOURCE_TYPES.join(",")}
                    className="sr-only"
                    aria-label="Logo file"
                    onChange={(e) => onFile(e.target.files?.[0])}
                  />
                </div>
              </Field>
            </div>
            <div className="md:col-span-2 lg:col-span-1">
              <Field label="Theme colour">
                <BrandColorPicker key={generation} color={settings.color} onChange={(color) => update({ color })} />
              </Field>
            </div>
          </div>
        </div>
      </section>

      <DemoCheckout
        key={runKey}
        branding={{
          name: merchantName,
          logoUrl: settings.logo,
          color: settings.color,
          supportEmail: null,
          contact: null,
          poweredBy: true,
        }}
        title={settings.title}
        description={settings.description}
        amountUsd={settings.amountUsd}
      />
    </div>
  );
}

/** A labelled control; `id` ties the label to a single input. */
function Field({ label, id, hint, children }: { label: string; id?: string; hint?: string; children: ReactNode }) {
  const labelClass = "mb-2 block text-[14px] font-medium text-default-900";
  return (
    <div>
      {id ? (
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
      ) : (
        <p className={labelClass}>{label}</p>
      )}
      {children}
      {hint && <p className="mt-1.5 text-[12.5px] text-default-500">{hint}</p>}
    </div>
  );
}
