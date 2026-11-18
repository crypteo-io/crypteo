import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkoutFooterSchema,
  checkoutPalette,
  toCheckoutBranding,
  contrastRatio,
  DEFAULT_CHECKOUT_PALETTE,
  normalizeBrandColor,
  paymentBrandingSchema,
} from "./branding";

describe("normalizeBrandColor", () => {
  it("accepts 3- and 6-digit hex, with or without #, any case", () => {
    expect(normalizeBrandColor("#ABC")).toBe("#aabbcc");
    expect(normalizeBrandColor(" 135CA4 ")).toBe("#135ca4");
  });

  it("refuses anything that isn't a hex colour", () => {
    for (const bad of ["", "red", "#12345", "#1234567", "rgb(0,0,0)", "#ggg", "#fff;}body{"]) {
      expect(normalizeBrandColor(bad)).toBeNull();
    }
  });
});

describe("checkoutPalette", () => {
  it("is Crypteo's palette without a colour, or with an invalid one", () => {
    expect(checkoutPalette(null)).toEqual(DEFAULT_CHECKOUT_PALETTE);
    expect(checkoutPalette("not-a-colour")).toEqual(DEFAULT_CHECKOUT_PALETTE);
  });

  it("keeps the exact colour for buttons", () => {
    expect(checkoutPalette("#7c3aed").accent).toBe("#7c3aed");
  });

  it("darkens a light colour until text on white reaches 4.5:1", () => {
    for (const light of ["#facc15", "#ffffff", "#a3e635", "#5aa9f5"]) {
      const { ink } = checkoutPalette(light);
      expect(contrastRatio(ink, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("leaves an already-dark colour's ink untouched", () => {
    expect(checkoutPalette("#135ca4").ink).toBe("#135ca4");
  });

  it("labels buttons with whichever of white or near-black reads better", () => {
    expect(checkoutPalette("#facc15").onAccent).toBe("#060f16");
    expect(checkoutPalette("#1c2f41").onAccent).toBe("#ffffff");
  });
});

// The checkout is themed through the ck tokens only. A hard-coded brand class
// (bg-primary, text-sky, ...) would stay Crypteo-blue on a merchant's checkout.
describe("checkout colour tokens", () => {
  const dir = path.join(__dirname, "..", "components", "checkout");
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));

  it.each(files)("%s uses no fixed brand colour class", (file) => {
    const source = readFileSync(path.join(dir, file), "utf8");
    expect(source).not.toMatch(/\b(?:bg|text|border|ring|from|to|via)-(?:primary|sky|brand)(?:-[a-z]+)?\b/);
  });
});

describe("checkoutFooterSchema", () => {
  const footer = { supportEmail: null, supportLinkLabel: null, supportLinkUrl: null, showPoweredBy: false, showSupportEmail: true };

  it("takes only an https link, since buyers open it from the checkout", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "http://shop.example", "shop.example"]) {
      expect(checkoutFooterSchema.safeParse({ ...footer, supportLinkUrl: url }).success).toBe(false);
    }
    expect(checkoutFooterSchema.parse({ ...footer, supportLinkUrl: "https://shop.example/contact" }).supportLinkUrl).toBe(
      "https://shop.example/contact",
    );
  });

  it("normalises the email and empties a blank label", () => {
    const parsed = checkoutFooterSchema.parse({ ...footer, supportEmail: " Help@Shop.Example ", supportLinkLabel: "  " });
    expect(parsed).toMatchObject({ supportEmail: "help@shop.example", supportLinkLabel: null });
    expect(checkoutFooterSchema.safeParse({ ...footer, supportEmail: "not-an-email" }).success).toBe(false);
  });
});

describe("toCheckoutBranding", () => {
  it("shows a link only with a URL, labelled by default", () => {
    const base = {
      name: "Shop",
      brandName: null,
      brandColor: null,
      logo: null,
      supportEmail: null,
      supportLinkLabel: null,
      showPoweredBy: true,
      showSupportEmail: true,
    };
    expect(toCheckoutBranding({ ...base, supportLinkUrl: null }).contact).toBeNull();
    expect(toCheckoutBranding({ ...base, supportLinkUrl: "https://s.example" }).contact).toEqual({
      label: "Contact us",
      url: "https://s.example",
    });
  });
});

describe("per-payment branding (user, 2026-11-18)", () => {
  const merchant = {
    name: "Account Ltd",
    brandName: "Main Shop",
    brandColor: "#135ca4",
    logo: { id: "logo1" },
    supportEmail: "help@main.example",
    supportLinkLabel: null,
    supportLinkUrl: null,
    showPoweredBy: false,
    showSupportEmail: true,
  };

  it("uses the dashboard's branding, the company name over the account name", () => {
    expect(toCheckoutBranding(merchant)).toMatchObject({ name: "Main Shop", color: "#135ca4", logoUrl: "/api/brand-logo/logo1" });
    expect(toCheckoutBranding({ ...merchant, brandName: null }).name).toBe("Account Ltd");
  });

  it("lays a payment's own branding over it field by field", () => {
    const b = toCheckoutBranding(merchant, {
      name: "Site B",
      logoUrl: "https://site-b.example/logo.png",
      showSupportEmail: false,
      supportLinkUrl: "https://site-b.example/help",
    });
    expect(b).toMatchObject({
      name: "Site B",
      color: "#135ca4",
      logoUrl: "https://site-b.example/logo.png",
      supportEmail: "help@main.example",
      showSupportEmail: false,
      contact: { label: "Contact us", url: "https://site-b.example/help" },
    });
  });

  it("never trusts a stored value it can't parse", () => {
    const b = toCheckoutBranding(merchant, { logoUrl: "javascript:alert(1)", name: "Site B" });
    expect(b.name).toBe("Main Shop");
    expect(b.logoUrl).toBe("/api/brand-logo/logo1");
  });

  it("only accepts https links and hex colours", () => {
    expect(paymentBrandingSchema.safeParse({ logoUrl: "http://x.example/l.png" }).success).toBe(false);
    expect(paymentBrandingSchema.safeParse({ supportLinkUrl: "data:text/html,x" }).success).toBe(false);
    expect(paymentBrandingSchema.safeParse({ color: "#fff;}body{" }).success).toBe(false);
    expect(paymentBrandingSchema.parse({ color: "ABC" })).toEqual({ color: "#aabbcc" });
  });
});
