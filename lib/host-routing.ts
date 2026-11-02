import { adminOrigin, siteOrigin } from "./admin-host";
import { SOLUTIONS } from "./content/solution-links";
import { isCustomHostPath } from "./custom-host";
import { WOOCOMMERCE_PLUGIN_PATH } from "./site-links";
import { NextResponse, type NextRequest } from "next/server";

// Which host serves what (proxy.ts runs these): the admin dashboard on the
// admin host at bare paths, the site and merchant dashboard everywhere else.

// Admin pages that used to live under /dashboard on the site; old links and
// bookmarks are sent to the same page on the admin host.
const MOVED_ADMIN_PATHS = [
  "/dashboard/merchants",
  "/dashboard/orphans",
  "/dashboard/analytics",
  "/dashboard/revenue",
  "/dashboard/contact",
  "/dashboard/blog",
];

const AUTH_PATHS = [
  "/login",
  "/register",
  "/verify",
  "/forgot-password",
  "/reset-password",
];
// The admin host's only account pages: sign-in and password reset. Admin
// accounts are created by admins, never signed up for.
const ADMIN_HOST_AUTH_PATHS = ["/login", "/forgot-password", "/reset-password"];

const startsWithSegment = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** An old /dashboard admin URL: sent on to the admin host, signed in or not. */
export const isMovedAdminPath = (pathname: string) =>
  MOVED_ADMIN_PATHS.some((p) => startsWithSegment(pathname, p));

export const isAuthRoute = (pathname: string) =>
  AUTH_PATHS.some((p) => startsWithSegment(pathname, p));

/**
 * A page's share image (an opengraph-image.tsx route): public, so a crawler
 * gets the image rather than a sign-in redirect. Inside a route group Next
 * adds a hash to the path (opengraph-image-14tosy); generateImageMetadata
 * adds an id segment (opengraph-image/card).
 */
export const isShareImagePath = (pathname: string) =>
  /\/opengraph-image(?:-[a-z0-9]+)?(?:\/card)?$/.test(pathname);

const PUBLIC_PAGES = [
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/playground",
  "/checkout-demo",
  "/faq",
  "/pricing",
  "/blog",
  WOOCOMMERCE_PLUGIN_PATH,
  ...SOLUTIONS.map((s) => s.path),
];

/**
 * Site paths anyone may open without a session (proxy.ts). Everything else
 * needs one. robots.txt and sitemap.xml must be here: crawlers that were
 * redirected to the login page couldn't read either.
 */
export function isPublicSitePath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /\.(?:svg|png|jpg|jpeg|gif|webp)$/.test(pathname) ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/checkout/") ||
    pathname.startsWith("/pay/") ||
    pathname.startsWith("/docs") ||
    startsWithSegment(pathname, "/blog") ||
    PUBLIC_PAGES.includes(pathname) ||
    isShareImagePath(pathname)
  );
}

/** "/dashboard/merchants/x" → "/merchants/x"; "/dashboard" → "/". */
const stripPrefix = (pathname: string, prefix: string) =>
  pathname.slice(prefix.length) || "/";

const ADMIN_ROBOTS = "User-agent: *\nDisallow: /\n";

/**
 * The admin host: app/admin under bare paths, for admin accounts only. API
 * routes do their own auth (requireAdmin), so they pass through untouched.
 */
export function routeAdminHost(req: NextRequest, role: string | undefined) {
  const { pathname, search } = req.nextUrl;
  const here = (path: string) => new URL(`${path}${search}`, req.url);

  if (pathname.startsWith("/api/")) return NextResponse.next();
  if (pathname === "/robots.txt") {
    return new NextResponse(ADMIN_ROBOTS, {
      headers: { "content-type": "text/plain" },
    });
  }
  for (const prefix of ["/dashboard", "/admin"]) {
    if (startsWithSegment(pathname, prefix)) {
      return NextResponse.redirect(here(stripPrefix(pathname, prefix)));
    }
  }
  if (ADMIN_HOST_AUTH_PATHS.some((p) => startsWithSegment(pathname, p))) {
    return role === "admin"
      ? NextResponse.redirect(here("/"))
      : NextResponse.next();
  }
  if (isAuthRoute(pathname))
    return NextResponse.redirect(new URL("/login", req.url));
  if (!role) {
    const login = new URL("/login", req.url);
    login.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  if (role !== "admin")
    return NextResponse.redirect(new URL("/dashboard", siteOrigin()));
  return NextResponse.rewrite(
    new URL(`/admin${pathname === "/" ? "" : pathname}${search}`, req.url),
  );
}

/** The merchant site: no admin pages, and admin sessions sent to the admin host. */
export function routeSite(req: NextRequest, role: string | undefined) {
  const { pathname, search } = req.nextUrl;
  // The admin dashboard is served on the admin host only.
  if (
    startsWithSegment(pathname, "/admin") ||
    pathname.startsWith("/api/admin/")
  ) {
    return NextResponse.rewrite(new URL("/404", req.url));
  }
  if (isMovedAdminPath(pathname)) {
    return NextResponse.redirect(
      new URL(`${stripPrefix(pathname, "/dashboard")}${search}`, adminOrigin()),
    );
  }
  // An admin session from before the admin host existed.
  if (
    role === "admin" &&
    (startsWithSegment(pathname, "/dashboard") || isAuthRoute(pathname))
  ) {
    return NextResponse.redirect(new URL("/", adminOrigin()));
  }
  if (isAuthRoute(pathname) && role) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  return NextResponse.next();
}

/**
 * A merchant's own hostname: their payment links and checkouts only. Which
 * merchant it belongs to is checked by those pages (servesHost), since the
 * proxy has no database.
 */
export function routeCustomHost(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/robots.txt") {
    return new NextResponse("User-agent: *\nAllow: /pay/\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
  }
  return isCustomHostPath(pathname) ? NextResponse.next() : NextResponse.rewrite(new URL("/404", req.url));
}
