import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { customDomainSchema } from "./custom-domain";
import { isCustomHost, isCustomHostPath, isInternalHost, paymentLinkUrl, servesHost } from "./custom-host";

const saved = process.env.NEXTAUTH_URL;
beforeEach(() => {
  process.env.NEXTAUTH_URL = "https://crypteo.io";
});
afterEach(() => {
  process.env.NEXTAUTH_URL = saved;
});

describe("isCustomHost", () => {
  it("is someone else's hostname, never ours or an internal name", () => {
    expect(isCustomHost("pay.shop.com")).toBe(true);
    expect(isCustomHost("Pay.Shop.com:443")).toBe(true);
    for (const host of ["crypteo.io", "www.crypteo.io", "admin.crypteo.io", "domains.crypteo.io", "app:3000", "localhost:3000", "admin.localhost:3100", "127.0.0.1", null]) {
      expect(isCustomHost(host)).toBe(false);
    }
  });
});

describe("isCustomHostPath", () => {
  it("answers payment pages and what they load, nothing else", () => {
    for (const p of ["/pay/abc", "/checkout/abc", "/checkout/abc/pay", "/api/payments/abc", "/api/payments/abc/simulate", "/api/brand-logo/x", "/coins/eth-icon.png"]) {
      expect(isCustomHostPath(p)).toBe(true);
    }
    for (const p of ["/", "/login", "/dashboard", "/api/payments/abc/mark-paid", "/api/wallets", "/api/auth/session", "/docs"]) {
      expect(isCustomHostPath(p)).toBe(false);
    }
  });
});

describe("servesHost", () => {
  const owner = { customDomain: "pay.shop.com", customDomainVerifiedAt: new Date() };
  it("serves a merchant's pages only on their own verified domain, and everyone's on ours", () => {
    expect(servesHost(owner, "pay.shop.com")).toBe(true);
    expect(servesHost(owner, "pay.other.com")).toBe(false);
    expect(servesHost({ ...owner, customDomainVerifiedAt: null }, "pay.shop.com")).toBe(false);
    expect(servesHost({ customDomain: null, customDomainVerifiedAt: null }, "crypteo.io")).toBe(true);
  });

  it("puts links on the verified domain only", () => {
    expect(paymentLinkUrl("l1", owner)).toBe("https://pay.shop.com/pay/l1");
    expect(paymentLinkUrl("l1", { ...owner, customDomainVerifiedAt: null })).toBe("https://crypteo.io/pay/l1");
  });
});

describe("customDomainSchema", () => {
  it("takes a subdomain, cleaned of scheme and path", () => {
    expect(customDomainSchema.parse(" https://Pay.Shop.com/x ")).toBe("pay.shop.com");
  });
  it("refuses apex domains, our hostnames and junk", () => {
    for (const v of ["shop.com", "pay.crypteo.io", "-x.shop.com", "pay.shop.123", "a b.shop.com"]) {
      expect(customDomainSchema.safeParse(v).success, v).toBe(false);
    }
  });
});

describe("isInternalHost", () => {
  it("is a caller on this machine, never a public hostname", () => {
    for (const host of ["app:3000", "localhost:3000", "127.0.0.1:3000", "admin.localhost:3100", null]) {
      expect(isInternalHost(host)).toBe(true);
    }
    for (const host of ["crypteo.io", "pay.shop.com"]) expect(isInternalHost(host)).toBe(false);
  });
});
