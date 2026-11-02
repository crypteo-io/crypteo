import {
  ADMIN_ROLE,
  softDeleteMerchantOps,
  wouldRemoveLastAdmin,
} from "@/lib/admin";
import { flagProbeInput } from "@/lib/abuse-signals";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { accountNameSchema } from "@/lib/account-schemas";
import { reservedNameRefusal } from "@/lib/reserved-names";
import { passwordErrorMessage, passwordRegex } from "@/lib/validation";
import { hash, verify } from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export async function PUT(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = z
    .object({ name: accountNameSchema })
    .safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid name" },
      { status: 400 },
    );
  }
  const { name } = parsed.data;
  // The role from the database: the session's can be minutes stale.
  const account = await prisma.merchant.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const refusal = reservedNameRefusal(name, account.role);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });
  await prisma.merchant.update({
    where: { id: session.user.id },
    data: { name },
  });
  await flagProbeInput(session.user.id, "Account name", { name });
  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { currentPassword, newPassword } = (await req.json().catch(() => null)) ?? {};
  if (typeof currentPassword !== "string")
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 400 },
    );
  if (typeof newPassword !== "string" || !passwordRegex.test(newPassword))
    return NextResponse.json({ error: passwordErrorMessage }, { status: 400 });
  const merchant = await prisma.merchant.findUnique({
    where: { id: session.user.id },
  });
  if (!merchant)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const valid = await verify(merchant.password, currentPassword);
  if (!valid)
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 400 },
    );

  const hashed = await hash(newPassword);
  await prisma.merchant.update({
    where: { id: session.user.id },
    // Revokes other sessions (and, at the next periodic re-check, this one)
    // opened before the change — see revalidateToken in lib/auth.ts.
    data: { password: hashed, passwordChangedAt: new Date() },
  });
  return NextResponse.json({ success: true });
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user || session.user.role !== "admin")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const merchants = await prisma.merchant.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });
  return NextResponse.json(merchants);
}
export async function DELETE(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (
    session.user.role === ADMIN_ROLE &&
    (await wouldRemoveLastAdmin(session.user.id))
  ) {
    return NextResponse.json(
      { error: "Promote another admin before deleting the last admin account" },
      { status: 409 },
    );
  }

  await prisma.$transaction([...(await softDeleteMerchantOps(session.user.id))]);

  return NextResponse.json({ success: true });
}
