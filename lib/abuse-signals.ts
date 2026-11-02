import { adminUrl } from "./admin-host";
import { sendAdminAlert } from "./admin-alerts";
import { prisma } from "./db";
import { suspiciousInputHtml } from "./emails/templates";
import { notifyAdmins } from "./notifications";
import { HOUR_MS } from "./time";

/**
 * Text that reads as an injection probe rather than a business's copy. On
 * 2026-10-23 a fuzzer created payment links titled `probe'`, `probe''`,
 * `probe"` and `probe or 1=1`. Every value is stored and rendered safely
 * (parameterised queries, escaped output), so a match is never refused: it
 * tells admins someone is testing the platform with a real account.
 */
const PROBES: { label: string; pattern: RegExp }[] = [
  { label: "SQL injection", pattern: /\bor\s+['"]?\d+['"]?\s*=\s*['"]?\d+|\bunion\s+(all\s+)?select\b|;\s*(drop|delete|insert|update)\s|\b(pg_)?sleep\s*\(|['"]\s*(--|#)/i },
  { label: "quote fuzzing", pattern: /^[^'"]*\w(['"])\1?$/ },
  { label: "script injection", pattern: /<\s*\/?\s*(script|img|svg|iframe|body)\b|\bon[a-z]+\s*=|javascript\s*:/i },
  { label: "template injection", pattern: /\{\{.*\}\}|\$\{.*\}|<%.*%>/ },
  { label: "path traversal", pattern: /\.\.[/\\]/ },
];

/** What a value looks like a probe for, or null when it reads as ordinary text. */
export function probeKind(value: string): string | null {
  return PROBES.find((p) => p.pattern.test(value.trim()))?.label ?? null;
}

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
