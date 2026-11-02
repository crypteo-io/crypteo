import { ADMIN_ROLE, auditLog, requireAdmin, ROLES } from "@/lib/admin";
import { announceAdminGrant, confirmsOwnPassword, GRANT_PASSWORD_MESSAGE } from "@/lib/admin-grant";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  merchantEmailSchema,
  accountNameSchema,
  passwordSchema,
} from "@/lib/account-schemas";
import {
  RESERVED_EMAIL_MESSAGE,
  RESERVED_NAME_MESSAGE,
  reservedEmailRefusal,
  reservedNameRefusal,
} from "@/lib/reserved-names";
import { Prisma } from "@prisma/client";
import { hash } from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const createSchema = z
  .object({
    name: accountNameSchema,
    email: merchantEmailSchema,
    password: passwordSchema,
    role: z.enum(ROLES).default("merchant"),
    // The acting admin's own password, required to create an admin.
    adminPassword: z.string().max(200).optional(),
  })
  .refine((v) => !reservedNameRefusal(v.name, v.role), {
    message: RESERVED_NAME_MESSAGE,
    path: ["name"],
  })
  .refine((v) => !reservedEmailRefusal(v.email, v.role), {
    message: RESERVED_EMAIL_MESSAGE,
    path: ["email"],
  });

/** Create an account on a merchant's behalf. Its email counts as verified. */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { name, email, password, role, adminPassword } = parsed.data;
  if (role === ADMIN_ROLE && !(await confirmsOwnPassword(admin.id, adminPassword))) {
    return NextResponse.json({ error: GRANT_PASSWORD_MESSAGE, field: "adminPassword" }, { status: 403 });
  }

  try {
    const merchant = await prisma.merchant.create({
      data: {
        name,
        email,
        password: await hash(password),
        role,
        emailVerified: new Date(),
      },
      select: { id: true },
    });
    await auditLog(prisma, admin, merchant.id, "create", { email, role });
    if (role === ADMIN_ROLE) {
      console.warn(`[admin] ${admin.email} created admin account ${email}`);
      await announceAdminGrant({
        accountId: merchant.id,
        accountName: name,
        accountEmail: email,
        grantedBy: admin.email,
        ip: clientIp(req),
      });
    }
    return NextResponse.json({ id: merchant.id }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }
    console.error("[admin/merchants]", error);
    return NextResponse.json({ error: "Could not create the account" }, { status: 500 });
  }
}
