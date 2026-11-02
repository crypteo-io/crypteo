import { describe, expect, it } from "vitest";
import { isSupportedPair } from "./chains/registry";
import {
  clampDemoAmount,
  DEFAULT_DEMO_SETTINGS,
  DEMO_LIMITS,
  DEMO_LOGO_MAX_CHARS,
  DEMO_RATES,
  DEMO_WALLETS,
  isDemoLogo,
  parseDemoSettings,
} from "./checkout-demo";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("parseDemoSettings", () => {
  it("falls back to the defaults for anything that isn't an object", () => {
    for (const raw of [null, undefined, "x", 42, []]) {
      expect(parseDemoSettings(raw)).toMatchObject({ name: DEFAULT_DEMO_SETTINGS.name, color: null, logo: null });
    }
  });

  it("keeps valid fields and normalises the colour", () => {
    const s = parseDemoSettings({ name: "Acme", title: "T", description: "D", amountUsd: 12.345, color: "#ABC", logo: PNG });
    expect(s).toEqual({ name: "Acme", title: "T", description: "D", amountUsd: 12.35, color: "#aabbcc", logo: PNG });
  });

  it("truncates long text", () => {
    expect(parseDemoSettings({ name: "x".repeat(500) }).name).toHaveLength(DEMO_LIMITS.name);
  });

  it("drops a colour that isn't a hex colour", () => {
    expect(parseDemoSettings({ color: "red; background:url(x)" }).color).toBeNull();
  });
});

describe("isDemoLogo", () => {
  it("accepts base64 PNG, JPEG and WebP data URLs", () => {
    expect(isDemoLogo(PNG)).toBe(true);
    expect(isDemoLogo("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
    expect(isDemoLogo("data:image/webp;base64,UklGRg==")).toBe(true);
  });

  it("refuses SVG, other schemes and anything after the payload", () => {
    expect(isDemoLogo("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isDemoLogo("javascript:alert(1)")).toBe(false);
    expect(isDemoLogo("https://example.com/logo.png")).toBe(false);
    expect(isDemoLogo(`${PNG}"onerror="alert(1)`)).toBe(false);
  });

  it("refuses a logo over the storage cap", () => {
    expect(isDemoLogo(`data:image/png;base64,${"A".repeat(DEMO_LOGO_MAX_CHARS)}`)).toBe(false);
  });
});

describe("clampDemoAmount", () => {
  it("clamps to the demo's range and falls back on garbage", () => {
    expect(clampDemoAmount(0)).toBe(DEMO_LIMITS.minAmountUsd);
    expect(clampDemoAmount(1e12)).toBe(DEMO_LIMITS.maxAmountUsd);
    expect(clampDemoAmount("abc")).toBe(DEFAULT_DEMO_SETTINGS.amountUsd);
    expect(clampDemoAmount("19.99")).toBe(19.99);
  });
});

describe("demo wallets", () => {
  it("only offers pairs the real checkout accepts, each with a price", () => {
    for (const w of DEMO_WALLETS) {
      expect(isSupportedPair(w.chain, w.token)).toBe(true);
      expect(DEMO_RATES[w.token]).toBeGreaterThan(0);
    }
  });

  it("uses addresses no wallet would send to", () => {
    for (const w of DEMO_WALLETS) expect(w.address.toLowerCase()).toContain("demo");
  });
});
