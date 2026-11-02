import { accountNameSchema, merchantEmailSchema, passwordSchema } from "@/lib/account-schemas";
import {
  DEMOTE_RESERVED_EMAIL_MESSAGE,
  DEMOTE_RESERVED_NAME_MESSAGE,
  isReservedEmail,
  isReservedName,
  reservedEmailRefusal,
  reservedNameRefusal,
} from "@/lib/reserved-names";
import { isDeletedAccountEmail } from "@/lib/account-state";
import {
  ADMIN_ROLE,
  auditLog,
  refuseAdminAction,
  requireAdmin,
  ROLES,
  softDeleteMerchantOps,
  wouldRemoveLastAdmin,
} from "@/lib/admin";
import { announceAdminGrant, confirmsOwnPassword, GRANT_PASSWORD_MESSAGE } from "@/lib/admin-grant";
import { prisma } from "@/lib/db";
import { notifyAccountSecurityChange } from "@/lib/mailer";
import { notifyAdmins } from "@/lib/notifications";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { Prisma } from "@prisma/client";
import { hash } from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ID = /^[a-z0-9]{20,40}$/;

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setActive"), isActive: z.boolean() }),
  z.object({
    action: z.literal("updateProfile"),
    name: accountNameSchema.optional(),
    email: merchantEmailSchema.optional(),
  }),
  // Granting admin re-asks the acting admin's password (lib/admin-grant.ts).
  z.object({ action: z.literal("setRole"), role: z.enum(ROLES), password: z.string().max(200).optional() }),
  z.object({ action: z.literal("resetPassword"), newPassword: passwordSchema }),
  z.object({ action: z.literal("resetTwoFactor") }),
  z.object({ action: z.literal("verifyEmail") }),
  z.object({ action: z.literal("revokeSessions") }),
  // The bypass for the platform's own apps: a reason is required on the record
  // and every admin is told, so an exemption is never quiet.
  z.discriminatedUnion("feeExempt", [
    z.object({
      action: z.literal("setFeeExempt"),
      feeExempt: z.literal(true),
      reason: z.string().trim().min(5, "Give the reason for the exemption").max(300),
    }),
    z.object({ action: z.literal("setFeeExempt"), feeExempt: z.literal(false) }),
  ]),
  z.object({
    action: z.literal("setApiKeyActive"),
    keyId: z.string().regex(ID),
    isActive: z.boolean(),
  }),
  z.object({
    action: z.literal("setWalletActive"),
    walletId: z.string().regex(ID),
    isActive: z.boolean(),
  }),
  z.object({
    action: z.literal("setPaymentLinkActive"),
    linkId: z.string().regex(ID),
    isActive: z.boolean(),
  }),
]);
type Action = z.infer<typeof actionSchema>;

const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

const TARGET_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  emailVerified: true,
} as const;

/** The merchant-facing notice for an action, when the owner should hear of it. */
function noticeFor(action: Action): { action: string; value: string } | null {
  switch (action.action) {
    case "setActive":
      return action.isActive
        ? { action: "Account reactivated", value: "Reactivated by an administrator" }
        : { action: "Account suspended", value: "Suspended by an administrator" };
    case "updateProfile":
      return action.email
        ? { action: "Login email changed", value: `Now ${action.email}` }
        : null;
    case "setRole":
      return { action: "Account role changed", value: `Now ${action.role}` };
    case "resetPassword":
      return { action: "Password reset", value: "Reset by an administrator" };
    case "resetTwoFactor":
      return { action: "Two-factor reset", value: "Sign-in codes now arrive by email" };
    case "revokeSessions":
      return { action: "Signed out everywhere", value: "By an administrator" };
    default:
      return null;
  }
}

/**
 * A reserved name or platform-domain address is an admin's only: never given
 * to, kept by or verified for a merchant.
 */
function reservedRefusal(action: Action, target: { name: string; email: string; role: string }): string | null {
  switch (action.action) {
    case "updateProfile":
      return (
        (action.name ? reservedNameRefusal(action.name, target.role) : null) ??
        (action.email ? reservedEmailRefusal(action.email, target.role) : null)
      );
    case "setRole":
      if (action.role === ADMIN_ROLE) return null;
      if (isReservedName(target.name)) return DEMOTE_RESERVED_NAME_MESSAGE;
      return isReservedEmail(target.email) ? DEMOTE_RESERVED_EMAIL_MESSAGE : null;
    case "verifyEmail":
      return reservedEmailRefusal(target.email, target.role);
    default:
      return null;
  }
}

/** The audit entry's details: never the password itself. */
function auditDetails(action: Action): Prisma.InputJsonValue {
  if (action.action === "resetPassword") return {};
  return Object.fromEntries(Object.entries(action).filter(([key]) => key !== "action" && key !== "password"));
}

/**
 * Apply one action inside the caller's transaction. Returns an error response,
 * or null once it's written.
 */
async function applyAction(
  tx: Prisma.TransactionClient,
  id: string,
  action: Action,
  passwordHash: string | null,
): Promise<NextResponse | null> {
  switch (action.action) {
    case "setActive":
      await tx.merchant.update({ where: { id }, data: { isActive: action.isActive } });
      return null;
    case "updateProfile": {
      if (!action.name && !action.email) return fail("Nothing to change", 400);
      await tx.merchant.update({
        where: { id },
        data: { name: action.name, email: action.email },
      });
      return null;
    }
    case "setRole":
      await tx.merchant.update({ where: { id }, data: { role: action.role } });
      return null;
    case "resetPassword":
      if (!passwordHash) return fail("Password not hashed", 500);
      await tx.merchant.update({
        where: { id },
        data: { password: passwordHash, passwordChangedAt: new Date() },
      });
      return null;
    case "resetTwoFactor":
      await tx.merchant.update({
        where: { id },
        data: {
          twoFactorMethod: "email",
          totpSecret: null,
          totpPendingSecret: null,
          totpLastUsedStep: null,
        },
      });
      return null;
    case "verifyEmail":
      await tx.merchant.updateMany({
        where: { id, emailVerified: null },
        data: { emailVerified: new Date() },
      });
      return null;
    case "revokeSessions":
      await tx.merchant.update({ where: { id }, data: { sessionsRevokedAt: new Date() } });
      return null;
    case "setFeeExempt":
      await tx.merchant.update({
        where: { id },
        data: action.feeExempt
          ? { feeExempt: true, feeExemptReason: action.reason, feeExemptAt: new Date() }
          : {
              feeExempt: false,
              feeExemptReason: null,
              feeExemptAt: null,
              feeExemptBy: null,
              feesFromAt: new Date(),
            },
      });
      return null;
    case "setApiKeyActive": {
      const { count } = await tx.apiKey.updateMany({
        where: { id: action.keyId, merchantId: id },
        data: { isActive: action.isActive },
      });
      return count ? null : fail("API key not found", 404);
    }
    case "setWalletActive": {
      const { count } = await tx.wallet.updateMany({
        where: { id: action.walletId, merchantId: id },
        data: { isActive: action.isActive },
      });
      return count ? null : fail("Wallet not found", 404);
    }
    case "setPaymentLinkActive": {
      const { count } = await tx.paymentLink.updateMany({
        where: { id: action.linkId, merchantId: id },
        data: { isActive: action.isActive },
      });
      return count ? null : fail("Payment link not found", 404);
    }
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  if (!ID.test(id)) return fail("Invalid merchant id", 400);
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }
  const action = parsed.data;

  try {
    const target = await prisma.merchant.findUnique({ where: { id }, select: TARGET_SELECT });
    if (!target) return fail("Merchant not found", 404);

    const refusal = refuseAdminAction({
      actorId: admin.id,
      target,
      action,
      isLastAdmin: target.role === ADMIN_ROLE && (await wouldRemoveLastAdmin(id)),
    });
    if (refusal) return fail(refusal, 409);
    const reserved = reservedRefusal(action, target);
    if (reserved) return fail(reserved, 400);
    const promoting = action.action === "setRole" && action.role === ADMIN_ROLE && target.role !== ADMIN_ROLE;
    if (promoting && !(await confirmsOwnPassword(admin.id, action.password))) {
      return fail(GRANT_PASSWORD_MESSAGE, 403);
    }

    // Hashed outside the transaction: argon2 is deliberately slow.
    const passwordHash =
      action.action === "resetPassword" ? await hash(action.newPassword) : null;
    if (action.action === "setFeeExempt" && action.feeExempt && target.role !== "merchant") {
      return fail("Only merchant accounts are charged fees", 400);
    }
    const error = await prisma.$transaction(async (tx) => {
      const refused = await applyAction(tx, id, action, passwordHash);
      if (!refused && action.action === "setFeeExempt" && action.feeExempt) {
        await tx.merchant.update({ where: { id }, data: { feeExemptBy: admin.email } });
      }
      if (!refused) await auditLog(tx, admin, id, action.action, auditDetails(action));
      return refused;
    });
    if (error) return error;

    if (action.action === "setFeeExempt") {
      await notifyAdmins({
        kind: "admin_fee_exemption",
        title: action.feeExempt
          ? `Fee exemption granted: ${target.name}`
          : `Fee exemption removed: ${target.name}`,
        body: action.feeExempt
          ? `${admin.email} exempted this account from platform fees. Reason: ${action.reason}`
          : `${admin.email} removed this account's fee exemption.`,
        link: `/merchants/${id}`,
      });
    }

    if (promoting) {
      await announceAdminGrant({
        accountId: id,
        accountName: target.name,
        accountEmail: target.email,
        grantedBy: admin.email,
        ip: clientIp(req),
      });
    }

    const notice = noticeFor(action);
    if (notice) {
      notifyAccountSecurityChange({
        // An email change is announced to the address it moved away from.
        to: target.email,
        merchantName: target.name,
        action: notice.action,
        details: [{ label: "Change", value: notice.value }],
        ip: clientIp(req),
        reviewPath: "/dashboard/settings",
        role: target.role,
      });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return fail("An account with this email already exists", 409);
    }
    console.error("[admin/merchants/:id]", error);
    return fail("Could not update the account", 500);
  }
}

/** Soft delete, exactly as a merchant's own account deletion. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  if (!ID.test(id)) return fail("Invalid merchant id", 400);

  try {
    const target = await prisma.merchant.findUnique({ where: { id }, select: TARGET_SELECT });
    if (!target) return fail("Merchant not found", 404);
    if (isDeletedAccountEmail(target.email)) return fail("Account is already deleted", 409);
    if (target.id === admin.id) return fail("Delete your own account from Settings", 409);
    if (target.role === ADMIN_ROLE && (await wouldRemoveLastAdmin(id))) {
      return fail("Promote another admin before deleting the last admin account", 409);
    }

    await prisma.$transaction([
      ...(await softDeleteMerchantOps(id)),
      auditLog(prisma, admin, id, "delete", { email: target.email }),
    ]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/merchants/:id]", error);
    return fail("Could not delete the account", 500);
  }
}
