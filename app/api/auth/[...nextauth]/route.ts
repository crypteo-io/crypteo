import { GET, POST as handle } from "@/lib/auth";
import { rateLimitScoped } from "@/lib/rate-limit";
import { NextRequest } from "next/server";

/** Code guesses (login step two) per IP per minute. */
const SIGN_IN_ATTEMPTS_PER_MINUTE = 10;

type Context = { params: Promise<{ nextauth: string[] }> };

// Step two carries the emailed or authenticator code and has no captcha of its
// own (lib/auth.ts explains why), so it gets its own per-IP bucket.
async function POST(req: NextRequest, ctx: Context) {
  if (req.nextUrl.pathname.endsWith("/callback/credentials")) {
    const limited = await rateLimitScoped(req, "sign-in", SIGN_IN_ATTEMPTS_PER_MINUTE);
    if (limited) return limited;
  }
  return handle(req, ctx);
}

export { GET, POST };
