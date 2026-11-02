import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SOLUTIONS } from "./content/solution-links";
import { WOOCOMMERCE_PLUGIN_PATH } from "./site-links";
import { isPublicSitePath, isShareImagePath, routeAdminHost, routeCustomHost, routeSite } from "./host-routing";

// NEXTAUTH_URL is unset in tests: the site is crypteo.io and the admin
// host admin.crypteo.io (lib/admin-host.ts).
const request = (url: string) => new NextRequest(url);
const location = (res: Response) => res.headers.get("location");
const rewrite = (res: Response) => res.headers.get("x-middleware-rewrite");
const admin = (path: string, role?: string) => routeAdminHost(request(`https://admin.crypteo.io${path}`), role);
const site = (path: string, role?: string) => routeSite(request(`https://crypteo.io${path}`), role);

describe("admin host", () => {
  it("serves app/admin at bare paths to admins", () => {
    expect(rewrite(admin("/", "admin"))).toBe("https://admin.crypteo.io/admin");
    expect(rewrite(admin("/merchants/abc?tab=x", "admin"))).toBe(
      "https://admin.crypteo.io/admin/merchants/abc?tab=x",
    );
  });

  it("asks for sign-in, and sends a merchant session to the site", () => {
    expect(location(admin("/revenue"))).toBe("https://admin.crypteo.io/login?callbackUrl=%2Frevenue");
    expect(location(admin("/revenue", "merchant"))).toBe("https://crypteo.io/dashboard");
  });

  it("has a login and password reset but no sign-up", () => {
    expect(rewrite(admin("/login"))).toBeNull();
    expect(location(admin("/login"))).toBeNull();
    expect(location(admin("/forgot-password"))).toBeNull();
    expect(location(admin("/register"))).toBe("https://admin.crypteo.io/login");
    expect(location(admin("/verify?email=a"))).toBe("https://admin.crypteo.io/login");
  });

  it("maps old /dashboard links and the internal /admin prefix to bare paths", () => {
    expect(location(admin("/dashboard/merchants/abc", "admin"))).toBe("https://admin.crypteo.io/merchants/abc");
    expect(location(admin("/dashboard", "admin"))).toBe("https://admin.crypteo.io/");
    expect(location(admin("/admin/orphans", "admin"))).toBe("https://admin.crypteo.io/orphans");
  });

  it("lets API routes through and keeps crawlers out", async () => {
    expect(rewrite(admin("/api/admin/merchants"))).toBeNull();
    expect(location(admin("/api/admin/merchants"))).toBeNull();
    expect(await admin("/robots.txt").text()).toContain("Disallow: /");
  });
});

describe("site", () => {
  it("never serves the admin dashboard or its API", () => {
    expect(rewrite(site("/admin"))).toBe("https://crypteo.io/404");
    expect(rewrite(site("/admin/merchants", "admin"))).toBe("https://crypteo.io/404");
    expect(rewrite(site("/api/admin/merchants", "admin"))).toBe("https://crypteo.io/404");
  });

  it("sends old admin links and admin sessions to the admin host", () => {
    expect(location(site("/dashboard/merchants/abc?x=1"))).toBe("https://admin.crypteo.io/merchants/abc?x=1");
    expect(location(site("/dashboard", "admin"))).toBe("https://admin.crypteo.io/");
  });

  it("leaves merchants' pages alone", () => {
    expect(location(site("/dashboard/payments", "merchant"))).toBeNull();
    expect(rewrite(site("/dashboard/payments", "merchant"))).toBeNull();
    expect(location(site("/login", "merchant"))).toBe("https://crypteo.io/dashboard");
  });
});

describe("share images", () => {
  it("recognises page share images, hashed or not, and nothing else", () => {
    expect(isShareImagePath("/opengraph-image")).toBe(true);
    expect(isShareImagePath("/pricing/opengraph-image")).toBe(true);
    expect(isShareImagePath("/docs/opengraph-image-14tosy")).toBe(true);
    expect(isShareImagePath("/blog/hello/opengraph-image/card")).toBe(true);
    expect(isShareImagePath("/dashboard/opengraph-image/x")).toBe(false);
    expect(isShareImagePath("/dashboard")).toBe(false);
  });
});

describe("public site paths", () => {
  it("lets crawlers read robots.txt, the sitemap and share images", () => {
    for (const p of ["/robots.txt", "/sitemap.xml", "/opengraph-image", "/about/opengraph-image", "/", "/docs", "/terms"]) {
      expect(isPublicSitePath(p)).toBe(true);
    }
  });

  it("opens every solution page and the plugin download to visitors", () => {
    for (const s of SOLUTIONS) expect(isPublicSitePath(s.path)).toBe(true);
    expect(isPublicSitePath(WOOCOMMERCE_PLUGIN_PATH)).toBe(true);
  });

  it("keeps the dashboard behind a session", () => {
    for (const p of ["/dashboard", "/dashboard/payments", "/settings", "/downloads/other.zip"]) expect(isPublicSitePath(p)).toBe(false);
  });
});

describe("routeCustomHost", () => {
  const status = (path: string) => routeCustomHost(request(`https://pay.shop.com${path}`));
  it("serves a merchant's own domain their payment pages only", () => {
    expect(status("/pay/abc").headers.get("x-middleware-rewrite")).toBeNull();
    for (const path of ["/", "/login", "/dashboard", "/api/wallets"]) {
      expect(status(path).headers.get("x-middleware-rewrite")).toContain("/404");
    }
  });
});
