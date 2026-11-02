import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// next-auth v4 default session cookie names (lib/auth.config.ts sets none).
const SESSION_COOKIES = ["next-auth.session-token", "__Secure-next-auth.session-token"];

/**
 * Where the dashboard sends a browser whose account can no longer be used
 * (suspended or deleted): auth() already returns null, but the edge proxy
 * only decodes the JWT and would bounce /login back to /dashboard until the
 * token's next re-check. Deleting the cookie here ends that loop at once.
 * The login page shows a neutral message: like login itself, it doesn't say
 * whether an account is suspended. A session that is still valid is left
 * alone, so a link to this route can't sign anyone out.
 */
export async function GET(req: NextRequest) {
  if (await auth()) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  const res = NextResponse.redirect(new URL("/login?signedOut=1", req.url));
  for (const name of SESSION_COOKIES) {
    res.cookies.set(name, "", {
      maxAge: 0,
      path: "/",
      secure: name.startsWith("__Secure-"),
      httpOnly: true,
      sameSite: "lax",
    });
  }
  return res;
}
