import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { clipText, OG_CARDS, titleSize, type OgCard, type OgCardKey } from "./og-cards";

// The share-image renderer behind every opengraph-image.tsx route. Images are
// fixed per route and pre-rendered at build (the blog post's on request),
// never drawn from query-string text: an endpoint that rendered any caption
// would let anyone put words on a Crypteo-branded card.

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

// Satori reads TTF/OTF, not the woff2 next/font serves, so the brand faces
// are committed (assets/fonts, SIL OFL) and read once per process.
const assets = (() => {
  let loaded: Promise<{ display: Buffer; text: Buffer; mark: string }> | null = null;
  return () =>
    (loaded ??= Promise.all([
      readFile(join(process.cwd(), "assets/fonts/InterDisplay-SemiBold.ttf")),
      readFile(join(process.cwd(), "assets/fonts/Inter-Medium.ttf")),
      readFile(join(process.cwd(), "public/icon.svg")),
    ]).then(([display, text, mark]) => ({
      display,
      text,
      mark: `data:image/svg+xml;base64,${mark.toString("base64")}`,
    })));
})();

export async function ogImage(card: OgCard): Promise<ImageResponse> {
  const { display, text, mark } = await assets();
  const title = clipText(card.title, 90);
  const subtitle = card.subtitle ? clipText(card.subtitle, 120) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: 40,
          background: "linear-gradient(180deg, #cfe2f5 0%, #e8f1fa 45%, #f8fafc 100%)",
          fontFamily: "Inter",
        }}
      >
        {/* The landing page's .frame: a pale slate border around a white panel. */}
        <div
          style={{
            flex: 1,
            display: "flex",
            padding: 12,
            borderRadius: 32,
            border: "2px solid #e2e8f0",
            background: "rgba(241, 245, 249, 0.7)",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "52px 60px",
              borderRadius: 24,
              border: "2px solid #f1f5f9",
              background: "#ffffff",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- rendered by Satori, not the browser */}
                <img src={mark} width={52} height={52} alt="" />
                <span style={{ fontFamily: "Inter Display", fontSize: 36, color: "#060f16", letterSpacing: -0.8 }}>
                  Crypteo
                </span>
              </div>
              <span
                style={{
                  display: "flex",
                  padding: "10px 22px",
                  borderRadius: 14,
                  border: "2px solid rgba(6, 15, 22, 0.1)",
                  background: "rgba(6, 15, 22, 0.03)",
                  fontSize: 24,
                  color: "#060f16",
                }}
              >
                {card.eyebrow}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div
                style={{
                  fontFamily: "Inter Display",
                  fontSize: titleSize(title),
                  lineHeight: 1.08,
                  letterSpacing: -2,
                  color: "#060f16",
                  maxWidth: 980,
                }}
              >
                {title}
              </div>
              {subtitle && (
                <div style={{ fontSize: 29, lineHeight: 1.4, color: "#475569", maxWidth: 940 }}>{subtitle}</div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, color: "#64748b" }}>
              <span style={{ width: 12, height: 12, borderRadius: 999, background: "#5aa9f5" }} />
              crypteo.io · Non-custodial crypto payments
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Inter Display", data: display, weight: 600, style: "normal" },
        { name: "Inter", data: text, weight: 500, style: "normal" },
      ],
    },
  );
}

/** One page's card, for its opengraph-image.tsx. */
export const ogImageFor = (key: OgCardKey) => ogImage(OG_CARDS[key]);
