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
import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import type { NextFetchEvent } from "next/server";

const withSession = withAuth(
  function middleware(req) {
    const role = req.nextauth.token?.role;
    return isAdminHost(req.headers.get("host")) ? routeAdminHost(req, role) : routeSite(req, role);
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
      signIn: "/login",
    },
  },
);

/**
 * A merchant's own hostname is routed before next-auth runs: its middleware
 * passes its sign-in page straight through, which served /login there.
 */
export default function proxy(req: NextRequestWithAuth, event: NextFetchEvent) {
  if (isCustomHost(req.headers.get("host"))) return routeCustomHost(req);
  return withSession(req, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo-*.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
