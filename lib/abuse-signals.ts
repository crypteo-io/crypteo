import { recordRiskEvent } from "./account-risk";
import { adminUrl } from "./admin-host";
import { sendAdminAlert } from "./admin-alerts";
import { prisma } from "./db";
import { certainProbe, probeKind } from "./probe-patterns";
import { suspiciousInputHtml } from "./emails/templates";
import { notifyAdmins } from "./notifications";
import { HOUR_MS } from "./time";

/** Admins hear about one account's probes at most this often. */
const PROBE_ALERT_EVERY_MS = 6 * HOUR_MS;

/**
 * Flag an account whose input reads as a probe: one admin notification and
 * alert email per account per PROBE_ALERT_EVERY_MS. Never throws, never
 * blocks the write that carried it.
 */
export async function flagProbeInput(
  merchantId: string,
  where: string,
  fields: Record<string, string | null | undefined>,
): Promise<void> {
  const hits = Object.entries(fields).flatMap(([field, value]) => {
    const kind = value ? probeKind(value) : null;
    return kind && value ? [{ field, value, kind }] : [];
  });
  if (hits.length === 0) return;
  // Only a certain probe suspends (lib/account-risk.ts); the rest is the
  // admin flag below, since a real name can look like a loose match.
  const certain = hits.filter((h) => certainProbe(h.value));
  if (certain.length) {
    await recordRiskEvent(merchantId, "probe_input", `${where}: ${certain.map((h) => `${h.field} (${h.kind}) ${h.value.slice(0, 80)}`).join("; ")}`);
  }

  try {
    const link = `/merchants/${merchantId}`;
    const recent = await prisma.notification.findFirst({
      where: { kind: "admin_probe", link, createdAt: { gt: new Date(Date.now() - PROBE_ALERT_EVERY_MS) } },
      select: { id: true },
    });
    if (recent) return;

    const account = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { name: true, email: true },
    });
    if (!account) return;

    await notifyAdmins({
      kind: "admin_probe",
      title: `Probe-like input from ${account.name}`,
      body: `${where}: ${hits.map((h) => `${h.field} looks like ${h.kind}`).join(", ")}`,
      link,
    });
    await sendAdminAlert(
      "Crypteo: probe-like input from an account",
      suspiciousInputHtml({
        merchantName: account.name,
        merchantEmail: account.email,
        where,
        hits,
        timestamp: new Date().toISOString(),
        pageUrl: adminUrl(link),
      }),
    );
  } catch (error) {
    console.error("[abuse-signals] probe flag not raised:", error);
  }
}
