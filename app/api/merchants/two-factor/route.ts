import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notifyAccountSecurityChange } from "@/lib/mailer";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  decryptSecret,
  effectiveTwoFactorMethod,
  encryptSecret,
  findTotpStep,
  generateTotpSecret,
  isAuthenticatorAvailable,
  totpUri,
  verifyTotpForMerchant,
} from "@/lib/two-factor";
import { verify } from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const codeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code");

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup") }),
  z.object({
    action: z.literal("enable"),
    code: codeSchema,
    password: z.string().min(1, "Password is required"),
  }),
]);

const deleteSchema = z.object({
  code: codeSchema,
  password: z.string().min(1, "Password is required"),
});

const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

async function loadMerchant(id: string) {
  return prisma.merchant.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      password: true,
      twoFactorMethod: true,
      totpSecret: true,
      totpPendingSecret: true,
    },
  });
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user) return fail("Unauthorized", 401);

  const merchant = await loadMerchant(session.user.id);
  if (!merchant) return fail("Not found", 404);
  return NextResponse.json({
    method: effectiveTwoFactorMethod(merchant),
    authenticatorAvailable: isAuthenticatorAvailable(),
  });
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user) return fail("Unauthorized", 401);

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }
  if (!isAuthenticatorAvailable()) {
    return fail("Authenticator apps are not available yet", 503);
  }

  const merchant = await loadMerchant(session.user.id);
  if (!merchant) return fail("Not found", 404);
  if (effectiveTwoFactorMethod(merchant) === "totp") {
    return fail("An authenticator is already enabled", 409);
  }

  try {
    if (parsed.data.action === "setup") {
      const secret = generateTotpSecret();
      await prisma.merchant.update({
        where: { id: merchant.id },
        data: { totpPendingSecret: encryptSecret(secret) },
      });
      return NextResponse.json({ secret, uri: totpUri(merchant.email, secret) });
    }

    const { code, password } = parsed.data;
    if (!(await verify(merchant.password, password))) {
      return fail("Password is incorrect", 400);
    }
    if (!merchant.totpPendingSecret) {
      return fail("Start the authenticator setup first", 409);
    }
    const pending = merchant.totpPendingSecret;
    const step = findTotpStep(decryptSecret(pending), code, Date.now(), null);
    if (step === null) return fail("That code is not valid. Try the current one.", 400);

    // Guarded on the pending secret it verified, so a second setup that
    // replaced it in the meantime can't be enabled with this code.
    const { count } = await prisma.merchant.updateMany({
      where: { id: merchant.id, totpPendingSecret: pending },
      data: {
        twoFactorMethod: "totp",
        totpSecret: pending,
        totpPendingSecret: null,
        totpLastUsedStep: step,
      },
    });
    if (count !== 1) return fail("Setup changed, start again", 409);

    notifyAccountSecurityChange({
      to: merchant.email,
      merchantName: merchant.name,
      action: "Authenticator app enabled",
      details: [{ label: "Sign-in codes", value: "Authenticator app" }],
      ip: clientIp(req),
      reviewPath: "/dashboard/settings",
      role: merchant.role,
    });
    return NextResponse.json({ method: "totp" });
  } catch (error) {
    console.error("[merchants/two-factor]", error);
    return fail("Could not update two-factor settings", 500);
  }
}

/** Switch back to emailed codes. Needs the password and a live authenticator code. */
export async function DELETE(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user) return fail("Unauthorized", 401);

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }

  const merchant = await loadMerchant(session.user.id);
  if (!merchant) return fail("Not found", 404);
  if (effectiveTwoFactorMethod(merchant) !== "totp") {
    return NextResponse.json({ method: "email" });
  }

  try {
    if (!(await verify(merchant.password, parsed.data.password))) {
      return fail("Password is incorrect", 400);
    }
    if (!(await verifyTotpForMerchant(merchant.id, parsed.data.code))) {
      return fail("That code is not valid. Try the current one.", 400);
    }
    await prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        twoFactorMethod: "email",
        totpSecret: null,
        totpPendingSecret: null,
        totpLastUsedStep: null,
      },
    });
    notifyAccountSecurityChange({
      to: merchant.email,
      merchantName: merchant.name,
      action: "Authenticator app removed",
      details: [{ label: "Sign-in codes", value: "Email" }],
      ip: clientIp(req),
      reviewPath: "/dashboard/settings",
      role: merchant.role,
    });
    return NextResponse.json({ method: "email" });
  } catch (error) {
    console.error("[merchants/two-factor]", error);
    return fail("Could not update two-factor settings", 500);
  }
}
