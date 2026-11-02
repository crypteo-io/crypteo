"use client";

import { checkoutPalette, DEFAULT_CHECKOUT_PALETTE, normalizeBrandColor } from "@/lib/branding";
import { Check, RotateCcw } from "lucide-react";
import { useState } from "react";

const PRESETS = [
  "#1c2f41",
  "#135ca4",
  "#0f766e",
  "#16a34a",
  "#7c3aed",
  "#db2777",
  "#e11d48",
  "#ea580c",
  "#facc15",
  "#111827",
];

/**
 * The checkout colour control: presets, a native picker and a hex field.
 * Shared by the branding page and the public checkout demo. `null` means
 * Crypteo's own colours.
 */
export function BrandColorPicker({
  color,
  onChange,
}: {
  color: string | null;
  onChange: (color: string | null) => void;
}) {
  const [hexDraft, setHexDraft] = useState(color ?? "");
  const palette = checkoutPalette(color);
  const inkAdjusted = color !== null && palette.ink !== palette.accent;

  const pick = (value: string) => {
    const hex = normalizeBrandColor(value);
    if (!hex) return;
    onChange(hex);
    setHexDraft(hex);
  };

  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Preset colours">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => pick(preset)}
            aria-label={`Use ${preset}`}
            aria-pressed={color === preset}
            className="flex size-9 items-center justify-center rounded-lg border border-black/10 transition-transform hover:scale-105"
            style={{ backgroundColor: preset }}
          >
            {color === preset && (
              <Check size={16} strokeWidth={3} style={{ color: checkoutPalette(preset).onAccent }} />
            )}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="relative size-12.5 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-default-200">
          <span className="sr-only">Pick a custom colour</span>
          <input
            type="color"
            value={palette.accent}
            onChange={(e) => pick(e.target.value)}
            className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 p-0"
          />
        </label>
        <input
          type="text"
          value={hexDraft}
          placeholder={DEFAULT_CHECKOUT_PALETTE.accent}
          onChange={(e) => {
            setHexDraft(e.target.value);
            const hex = normalizeBrandColor(e.target.value);
            if (hex) onChange(hex);
          }}
          onBlur={() => setHexDraft(color ?? "")}
          aria-label="Hex colour"
          spellCheck={false}
          className="field max-w-40 font-mono text-[14px] uppercase"
        />
        {color !== null && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setHexDraft("");
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-default-600 hover:text-default-950"
          >
            <RotateCcw size={14} /> Use Crypteo&apos;s colours
          </button>
        )}
      </div>

      {inkAdjusted && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-default-200 bg-default-50 p-3 text-[13px] text-default-600">
          <span className="mt-0.5 size-4 shrink-0 rounded" style={{ backgroundColor: palette.ink }} aria-hidden />
          This colour is light, so text and icons on white use a darker shade ({palette.ink}) to stay readable.
          Buttons keep your exact colour.
        </p>
      )}
    </>
  );
}
