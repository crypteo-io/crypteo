import { verify } from "argon2";
import { sendAdminAlert } from "./admin-alerts";
import { adminUrl } from "./admin-host";
import { prisma } from "./db";
import { adminAccessGrantedHtml } from "./emails/templates";
import { notifyAdmins } from "./notifications";

// Granting admin (promoting an account or creating one as admin) re-asks the
// acting admin's password, so a session left open is not enough to hand out
// platform-wide access, and every admin hears of it.

export const GRANT_PASSWORD_MESSAGE = "Your password is incorrect";

/** Whether the acting admin re-entered their own password. */
export async function confirmsOwnPassword(adminId: string, password: string | undefined): Promise<boolean> {
  if (!password) return false;
  const account = await prisma.merchant.findUnique({ where: { id: adminId }, select: { password: true } });
  return !!account && (await verify(account.password, password).catch(() => false));
}

/** Tell every admin, in-app and by email. Never throws. */
export async function announceAdminGrant(opts: {
  accountId: string;
  accountName: string;
  accountEmail: string;
  grantedBy: string;
  ip: string;
}): Promise<void> {
  const link = `/merchants/${opts.accountId}`;
  await notifyAdmins({
    kind: "admin_access",
    title: `Admin access granted: ${opts.accountName}`,
    body: `${opts.grantedBy} made ${opts.accountEmail} an admin.`,
    link,
  });
  try {
    await sendAdminAlert(
      "Crypteo: admin access granted",
      adminAccessGrantedHtml({
        accountName: opts.accountName,
        accountEmail: opts.accountEmail,
        grantedBy: opts.grantedBy,
        ip: opts.ip,
        timestamp: new Date().toISOString(),
        pageUrl: adminUrl(link),
      }),
    );
  } catch (error) {
    console.error("[admin-grant] alert not sent:", error);
  }
}
