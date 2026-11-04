import { isAdminHost } from "@/lib/admin-host";
import { isCustomHost } from "@/lib/custom-host";
import {
  isAuthRoute,
  isMovedAdminPath,
  isPublicSitePath,
  routeAdminHost,
  routeCustomHost,
  routeSite,
} from "@/lib/host-routing";
import { getToken } from "next-auth/jwt";
import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import type { NextFetchEvent, NextRequest } from "next/server";

const SIGN_IN_PATH = "/login";

const route = (req: NextRequest, role: string | undefined) =>
  isAdminHost(req.headers.get("host")) ? routeAdminHost(req, role) : routeSite(req, role);

const withSession = withAuth(
  function middleware(req) {
    return route(req, req.nextauth.token?.role);
  },
  {
    callbacks: {
      authorized: ({ req, token }) => {
        // The admin host decides for itself, above.
        if (isAdminHost(req.headers.get("host"))) return true;
        const pathname = req.nextUrl.pathname;

        if (isPublicSitePath(pathname) || isAuthRoute(pathname) || isMovedAdminPath(pathname)) {
          return true; // Always allow access
        }

        return !!token; // Require token for all other routes
      },
    },
    pages: {
      signIn: SIGN_IN_PATH,
    },
  },
);

/**
 * A merchant's own hostname is routed before next-auth runs: its middleware
 * passes its sign-in page straight through, which served /login there.
 */
export default async function proxy(req: NextRequestWithAuth, event: NextFetchEvent) {
  if (isCustomHost(req.headers.get("host"))) return routeCustomHost(req);
  // withAuth passes its sign-in page straight through too, so a signed-in
  // visitor to /login never reached the routing that sends them on. A bad or
  // expired cookie decodes to nothing and gets the login page. The target is
  // fixed: callbackUrl is never followed here.
  if (req.nextUrl.pathname === SIGN_IN_PATH) return route(req, (await getToken({ req }))?.role);
  return withSession(req, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo-*.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
