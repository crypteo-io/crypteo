import { hash } from "argon2";
import crypto from "crypto";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { DELETED_EMAIL_DOMAIN, isDeletedAccountEmail } from "./account-state";
import { auth } from "./auth";
import { prisma } from "./db";

export const ADMIN_ROLE = "admin";
export const MERCHANT_ROLE = "merchant";
export const ROLES = [ADMIN_ROLE, MERCHANT_ROLE] as const;
export type Role = (typeof ROLES)[number];

export interface AdminActor {
  id: string;
  email: string;
}

/**
 * The signed-in admin, re-read from the database, or the response to return.
 * The session's role can be up to 5 minutes stale (lib/auth.ts
 * SESSION_RECHECK_MS); an admin action must not be. proxy.ts lets every
 * /api/* route through, so each admin route calls this itself.
 */
export async function requireAdmin(): Promise<
  { admin: AdminActor; response?: never } | { admin?: never; response: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = await prisma.merchant.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, role: true, isActive: true },
  });
  if (!admin?.isActive || admin.role !== ADMIN_ROLE) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin: { id: admin.id, email: admin.email } };
}

/**
 * The session for an admin page. Anyone else, and an account suspended,
 * deleted or demoted since its cookie was issued, goes to session-ended,
 * which clears a dead cookie (the proxy only decodes the JWT, so /login
 * would bounce straight back here).
 */
export async function adminPageSession() {
  const session = await auth();
  if (!session?.user || session.user.role !== ADMIN_ROLE) redirect("/api/auth/session-ended");
  return session;
}

/**
 * Whether taking this admin out of service (demote, suspend, delete) would
 * leave the platform with no active admin, and so no way back in short of SQL.
 */
export async function wouldRemoveLastAdmin(merchantId: string): Promise<boolean> {
  const others = await prisma.merchant.count({
    where: { role: ADMIN_ROLE, isActive: true, id: { not: merchantId } },
  });
  return others === 0;
}

export function auditLog(
  db: Pick<Prisma.TransactionClient, "adminAuditLog">,
  admin: AdminActor,
  merchantId: string,
  action: string,
  details?: Prisma.InputJsonValue,
) {
  return db.adminAuditLog.create({
    data: { adminId: admin.id, adminEmail: admin.email, merchantId, action, details },
  });
}

/**
 * Why an admin action must not run, or null. Pure: the route looks up whether
 * the target is the last active admin and passes it in.
 */
export function refuseAdminAction(opts: {
  actorId: string;
  target: { id: string; email: string; role: string };
  action: { action: string; isActive?: boolean; role?: string };
  isLastAdmin: boolean;
}): string | null {
  const { actorId, target, action, isLastAdmin } = opts;
  if (isDeletedAccountEmail(target.email)) {
    return "Deleted accounts can't be changed";
  }
  const takesAdminOutOfService =
    target.role === ADMIN_ROLE &&
    ((action.action === "setActive" && action.isActive === false) ||
      (action.action === "setRole" && action.role !== ADMIN_ROLE));
  if (takesAdminOutOfService && target.id === actorId) {
    return "You can't suspend or demote your own account";
  }
  if (takesAdminOutOfService && isLastAdmin) {
    return "Promote another admin first: this is the last active admin";
  }
  return null;
}

/**
 * Soft delete, shared by self-delete and admin delete. A hard delete used to
 * cascade through Payment, erasing the financial record of every session (and
 * the only trail for deposits still in flight). Instead: deactivate the
 * account, stop it taking new payments, and scrub the personal data.
 */
export async function softDeleteMerchantOps(id: string) {
  const unusable = await hash(crypto.randomBytes(32).toString("hex"));
  return [
    prisma.apiKey.updateMany({ where: { merchantId: id }, data: { isActive: false } }),
    prisma.wallet.updateMany({ where: { merchantId: id }, data: { isActive: false } }),
    prisma.paymentLink.updateMany({
      where: { merchantId: id },
      data: { isActive: false },
    }),
    prisma.merchantLogo.deleteMany({ where: { merchantId: id } }),
    // Webhook URLs name the merchant's systems; nothing is delivered to a
    // deleted account's sites.
    prisma.webhookEndpoint.deleteMany({ where: { merchantId: id } }),
    prisma.merchant.update({
      where: { id },
      data: {
        isActive: false,
        name: "Deleted merchant",
        brandColor: null,
        supportEmail: null,
        supportLinkLabel: null,
        supportLinkUrl: null,
        customDomain: null,
        customDomainToken: null,
        customDomainVerifiedAt: null,
        // Unique + unroutable, which frees the real address for a new signup
        // and guarantees no further mail (OTP, payment notices) reaches it.
        email: `deleted+${id}${DELETED_EMAIL_DOMAIN}`,
        password: unusable,
        passwordChangedAt: new Date(),
        emailVerified: null,
        defaultWebhookUrl: null,
        webhookSecret: null,
        twoFactorMethod: "email",
        totpSecret: null,
        totpPendingSecret: null,
        totpLastUsedStep: null,
      },
    }),
  ] as const;
}
