import { formatAmount } from "@/lib/format";

// Every interpolated string below must go through esc(). Several fields are
// attacker-influenced — externalId and customerEmail arrive through the public
// API, error messages and stacks can echo RPC responses — and an email client
// renders whatever HTML reaches it. Numbers go through formatAmount (or are
// plain integers); HTML fragments built by this file itself are not escaped.
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for HTML element content and quoted attribute values. */
export function esc(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * An href that can only point at http(s) or mailto. Escaping alone would let a
 * `javascript:` URL through intact; anything unparseable or of another scheme
 * becomes an inert "#".
 */
export function safeHref(url: string | null | undefined): string {
  try {
    const u = new URL(String(url ?? ""));
    if (["http:", "https:", "mailto:"].includes(u.protocol)) {
      return esc(u.toString());
    }
  } catch {
    // fall through
  }
  return "#";
}

/** "0.0000005 btc" — never exponent notation, escaped token. */
function amt(amount: number | null | undefined, token: string | null): string {
  return `${formatAmount(amount, token)} ${esc(token)}`.trim();
}

// Crypteo email palette: the site's slate scale with navy buttons and sky links.
// Hex values, not CSS variables: email clients ignore custom properties.
const C = {
  page: "#f1f5f9", // slate-100
  surface: "#ffffff",
  border: "#e2e8f0", // slate-200
  subtle: "#f8fafc", // slate-50, summary tables
  heading: "#060f16",
  body: "#475569", // slate-600
  muted: "#64748b", // slate-500
  faint: "#94a3b8", // slate-400
  primary: "#1c2f41", // navy buttons
  sky: "#135ca4", // links and accents
  red: "#dc2626",
  orange: "#d97706",
  green: "#16a34a",
  blue: "#135ca4",
};

const FONT =
  "'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',SFMono-Regular,Menlo,Consolas,monospace";
const LOGO_URL = "https://crypteo.io/logo-email.png";
// public/logo-email.png is 560×128; shown at 140px wide (4× for retina).
const LOGO_WIDTH_PX = 140;
const LOGO_HEIGHT_PX = 32;

/** Inline style for the slate-50 key/value summary tables. */
const SUMMARY_TABLE = `background-color:${C.subtle};border:1px solid ${C.border};border-radius:12px;border-collapse:separate;`;

/**
 * The shared Crypteo email shell: slate page, white bordered card with the
 * logo header, and the non-custodial footer. Table-based with inline styles so
 * it survives Outlook and Gmail. `content` is trusted HTML built by this file
 * (or a caller that escaped every value with esc()); `subtitle` is a constant.
 */
export function emailLayout(content: string, subtitle = "Infrastructure Monitor"): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>Crypteo</title>
</head>
<body style="margin:0;padding:0;background-color:${C.page};font-family:${FONT};-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.page};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:${C.surface};border:1px solid ${C.border};border-radius:16px;border-collapse:separate;">

          <!-- Header -->
          <tr>
            <td style="padding:28px 40px 24px;border-bottom:1px solid ${C.border};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <a href="https://crypteo.io" style="text-decoration:none;"><img src="${LOGO_URL}" alt="Crypteo" width="${LOGO_WIDTH_PX}" height="${LOGO_HEIGHT_PX}" style="display:block;border:0;outline:none;width:${LOGO_WIDTH_PX}px;height:auto;" /></a>
                  </td>
                  <td align="right" style="vertical-align:middle;color:${C.muted};font-size:12px;font-weight:500;">${subtitle}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:0 40px 36px;">
              ${content}
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
          <tr>
            <td style="padding:24px 16px 0;text-align:center;font-family:${FONT};">
              <p style="margin:0;color:${C.body};font-size:13px;font-weight:600;">Crypteo · Non-custodial crypto payments</p>
              <p style="margin:6px 0 0;color:${C.muted};font-size:12px;line-height:1.6;">Buyers pay your own wallet directly. Crypteo never holds, routes or freezes your funds.</p>
              <p style="margin:6px 0 0;color:${C.faint};font-size:11px;">This is an automated notification from <a href="https://crypteo.io" style="color:${C.sky};text-decoration:none;">crypteo.io</a>. Please don't reply.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function statusBadge(label: string, color: string, bg: string): string {
  return `<span style="display:inline-block;background-color:${bg};color:${color};font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;padding:3px 10px;border-radius:999px;">${label}</span>`;
}

function divider(): string {
  return `<tr><td style="padding:0 0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:1px;line-height:1px;font-size:0;background-color:${C.border};">&nbsp;</td></tr></table></td></tr>`;
}

function metaRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:9px 12px 9px 20px;color:${C.muted};font-size:13px;width:140px;vertical-align:top;">${label}</td>
    <td style="padding:9px 20px 9px 0;color:${C.heading};font-size:13px;font-weight:500;vertical-align:top;">${value}</td>
  </tr>`;
}

/** Title block: a tinted icon tile (like the site's .icon-tile) beside the heading. */
function alertBanner(
  icon: string,
  title: string,
  color: string,
): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="padding:32px 0 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          <td width="48" height="48" align="center" style="width:48px;height:48px;background-color:${color};border-radius:12px;font-size:22px;line-height:48px;text-align:center;">${icon}</td>
          <td style="padding-left:16px;vertical-align:middle;">
            <h1 style="margin:0;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:600;color:${C.heading};letter-spacing:-0.02em;">${title}</h1>
          </td>
        </tr>
      </table>
    </td>
  </tr></table>`;
}

/** Navy call-to-action, table-wrapped so Outlook keeps the padding. */
function ctaButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0">
    <tr>
      <td style="background-color:${C.primary};border-radius:10px;">
        <a href="${safeHref(url)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

/** Monospace block for stacks and raw error text. `text` must already be escaped. */
function codeBlock(caption: string, text: string, color: string = C.heading, extra = ""): string {
  return `<div style="background-color:${C.subtle};border:1px solid ${C.border};border-radius:12px;padding:16px 20px;">
          <div style="color:${C.muted};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:10px;">${caption}</div>
          <pre style="margin:0;color:${color};font-family:${MONO};font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-all;">${text}</pre>${extra}
        </div>`;
}

// ─── SERVICE DOWN ────────────────────────────────────────────────────────────

export function serviceDownHtml(opts: {
  service: string;
  failures: number;
  error: string;
  timestamp: string;
}): string {
  return emailLayout(`
    ${alertBanner("🔴", `${esc(opts.service)} is Down`, "#fff1f1")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          The <strong>${esc(opts.service)}</strong> service has failed <strong>${opts.failures} consecutive health checks</strong> and is considered unreachable. Immediate attention may be required.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Service", esc(opts.service))}
          ${metaRow("Failed Checks", `${opts.failures}`)}
          ${metaRow("Detected At", esc(opts.timestamp))}
          ${metaRow("Error", `<span style="font-family:${MONO};font-size:12px;color:${C.red};word-break:break-all;">${esc(opts.error)}</span>`)}
        </table>
      </td></tr>
      ${divider()}
      <tr><td>
        <p style="margin:0;color:${C.muted};font-size:12px;">You will receive a recovery notification automatically when the service comes back online.</p>
      </td></tr>
    </table>
  `);
}

// ─── SERVICE RECOVERED ───────────────────────────────────────────────────────

export function serviceRecoveredHtml(opts: {
  service: string;
  responseTime: number;
  timestamp: string;
}): string {
  return emailLayout(`
    ${alertBanner("✅", `${esc(opts.service)} Recovered`, "#f0fdf4")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          <strong>${esc(opts.service)}</strong> is back online and responding normally.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Service", esc(opts.service))}
          ${metaRow("Response Time", `${opts.responseTime}ms`)}
          ${metaRow("Recovered At", esc(opts.timestamp))}
          ${metaRow("Status", statusBadge("Healthy", C.green, "#dcfce7"))}
        </table>
      </td></tr>
    </table>
  `);
}

// ─── SLOWDOWN ────────────────────────────────────────────────────────────────

export function slowdownHtml(opts: {
  service: string;
  responseTime: number;
  consecutiveCount: number;
  threshold: number;
  timestamp: string;
}): string {
  return emailLayout(`
    ${alertBanner("⚠️", `${esc(opts.service)} Slowdown Detected`, "#fffbeb")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          <strong>${esc(opts.service)}</strong> has been responding slowly for <strong>${opts.consecutiveCount} consecutive checks</strong>, exceeding the ${opts.threshold}ms threshold.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Service", esc(opts.service))}
          ${metaRow("Latest Response", `${opts.responseTime}ms`)}
          ${metaRow("Threshold", `${opts.threshold}ms`)}
          ${metaRow("Consecutive Slow", `${opts.consecutiveCount} checks`)}
          ${metaRow("Detected At", esc(opts.timestamp))}
          ${metaRow("Status", statusBadge("Degraded", C.orange, "#fff7ed"))}
        </table>
      </td></tr>
    </table>
  `);
}

// ─── DB ERROR ────────────────────────────────────────────────────────────────

export function dbErrorHtml(opts: { timestamp: string }): string {
  return emailLayout(`
    ${alertBanner("🗄️", "Database Connectivity Error", "#fff1f1")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          The health endpoint is reachable but reports a <strong>database failure</strong>. The app may be serving degraded or no responses.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Component", "PostgreSQL")}
          ${metaRow("Detected At", esc(opts.timestamp))}
          ${metaRow("Status", statusBadge("Error", C.red, "#fff1f1"))}
        </table>
      </td></tr>
    </table>
  `);
}

// ─── WORKER STALLED ──────────────────────────────────────────────────────────

export function workerStalledHtml(opts: {
  lastCycleAt: string | null;
  ageMs: number | null;
  lastError: string | null;
  timestamp: string;
}): string {
  const age =
    opts.ageMs === null
      ? "never reported"
      : `${Math.round(opts.ageMs / 1000)}s ago`;
  return emailLayout(`
    ${alertBanner("⛔", "Payment Worker Stalled", "#fff1f1")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          The payment worker has stopped reporting poll cycles. <strong>Incoming deposits are not being detected</strong> while it is down. Buyers can still send funds and those sessions will expire unpaid. Restart the <code style="background:${C.subtle};padding:2px 6px;border-radius:4px;font-size:12px;">worker</code> service and check its logs.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Component", "Payment Worker")}
          ${metaRow("Last Poll Cycle", esc(opts.lastCycleAt || "never"))}
          ${metaRow("Heartbeat Age", age)}
          ${opts.lastError ? metaRow("Last Error", esc(opts.lastError)) : ""}
          ${metaRow("Detected At", esc(opts.timestamp))}
          ${metaRow("Status", statusBadge("Stalled", C.red, "#fff1f1"))}
        </table>
      </td></tr>
    </table>
  `);
}

// ─── STUCK PAYMENTS ──────────────────────────────────────────────────────────

export function stuckPaymentsHtml(opts: {
  count: number;
  timestamp: string;
}): string {
  return emailLayout(`
    ${alertBanner("⏳", "Payments Stuck in Confirming", "#fffbeb")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          <strong>${opts.count} payment(s)</strong> have been in <code style="background:${C.subtle};padding:2px 6px;border-radius:4px;font-size:12px;">confirming</code> for over 6 hours. Funds were detected but confirmations never completed, usually because of an RPC or transaction-lookup failure. These need review before the 24-hour timeout closes them.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Stuck Payments", `${opts.count}`)}
          ${metaRow("Threshold", "> 6 hours in confirming")}
          ${metaRow("Detected At", esc(opts.timestamp))}
        </table>
      </td></tr>
    </table>
  `);
}

// ─── BACKUP FAILURE ──────────────────────────────────────────────────────────

export function backupFailureHtml(opts: {
  reason: string;
  lastBackupAt: string | null;
  lastStatus: string | null;
  sizeBytes: number | null;
  timestamp: string;
}): string {
  return emailLayout(`
    ${alertBanner("💾", "Database Backup Problem", "#fff1f1")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          The nightly database backup is not healthy: <strong>${esc(opts.reason)}</strong>. Payment records are the system of record for funds already received, so restore coverage should be fixed promptly.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Component", "PostgreSQL Backup")}
          ${metaRow("Last Backup", esc(opts.lastBackupAt || "never"))}
          ${metaRow("Last Status", esc(opts.lastStatus || "unknown"))}
          ${
            opts.sizeBytes !== null
              ? metaRow(
                  "Dump Size",
                  `${(opts.sizeBytes / 1024 / 1024).toFixed(2)} MB`,
                )
              : ""
          }
          ${metaRow("Detected At", esc(opts.timestamp))}
          ${metaRow("Status", statusBadge("Failing", C.red, "#fff1f1"))}
        </table>
      </td></tr>
    </table>
  `);
}

// ─── MONITOR FINDING ─────────────────────────────────────────────────────────

/**
 * Something a monitor check found. Not checkFailureHtml, which says the check
 * itself crashed: a real finding sent on that template ("threw an unexpected
 * error… a blind spot") read as a broken monitor, not as the problem it found.
 */
export function monitorFindingHtml(opts: {
  title: string;
  check: string;
  detail: string;
  timestamp: string;
}): string {
  return emailLayout(`
    ${alertBanner("⚠️", esc(opts.title), "#fffbeb")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">${esc(opts.detail)}</p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Check", esc(opts.check))}
          ${metaRow("Detected At", esc(opts.timestamp))}
        </table>
      </td></tr>
    </table>
  `);
}

// ─── MONITOR CHECK FAILURE ───────────────────────────────────────────────────

export function checkFailureHtml(opts: {
  check: string;
  error: string;
  timestamp: string;
}): string {
  return emailLayout(`
    ${alertBanner("🧪", "Monitor Check Failed", "#fffbeb")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          The <strong>${esc(opts.check)}</strong> check threw an unexpected error, so it is no longer reporting on what it monitors. This is a blind spot, not a healthy result: the underlying service may be failing unobserved.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Check", esc(opts.check))}
          ${metaRow("Error", esc(opts.error))}
          ${metaRow("Detected At", esc(opts.timestamp))}
        </table>
      </td></tr>
    </table>
  `);
}

export function chainDegradedHtml(opts: {
  degraded: { pair: string; error: string }[];
  healthy: string[];
  timestamp: string;
}): string {
  return emailLayout(`
    ${alertBanner("⛓️", "Chain Read Failure", "#fef2f2")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          The worker is running, but it <strong>cannot read balances</strong> for the chain/token pairs below. Deposits on these pairs will not be detected and sessions will expire as unpaid while buyers' funds arrive on-chain.
        </p>
        <p style="margin:12px 0 0;color:${C.body};font-size:14px;line-height:1.6;">
          This is almost always an RPC endpoint declining a method (a gated public node, a revoked key, or a rate limit). Check the error text, then point the relevant <code>*_RPC_URLS</code> environment variable at a working provider.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${opts.degraded
            .map((d) => metaRow(esc(d.pair), esc(d.error)))
            .join("")}
          ${metaRow("Still healthy", esc(opts.healthy.join(", ") || "none"))}
          ${metaRow("Detected At", esc(opts.timestamp))}
        </table>
      </td></tr>
    </table>
  `);
}

// ─── PROXY HEALTH ────────────────────────────────────────────────────────────

/** A proxy health scan's changes (lib/proxy-health.ts): proxies that started failing, or recovered. */
export function proxyHealthHtml(opts: {
  state: "failing" | "recovered";
  proxies: { name: string; isActive: boolean; error: string | null; lastOkAt: string | null }[];
  failingAfter: number;
  timestamp: string;
  pageUrl: string;
}): string {
  const failing = opts.state === "failing";
  const one = opts.proxies.length === 1;
  const intro = failing
    ? `${one ? "This proxy" : "These proxies"} failed ${opts.failingAfter} health checks in a row: real price and chain RPC requests sent through ${one ? "it" : "them"} did not get a valid answer, while the same requests sent direct did. Reads through a failing proxy fall back to a direct connection, so payments keep being detected, but fix or pause ${one ? "it" : "them"}.`
    : `${one ? "This proxy" : "These proxies"} passed ${one ? "its" : "their"} health check again after failing.`;
  return emailLayout(`
    ${alertBanner(failing ? "⛔" : "✅", failing ? "Proxy Failing" : "Proxy Recovered", failing ? "#fef2f2" : "#ecfdf5")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">${esc(intro)}</p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${opts.proxies
            .map((p) =>
              metaRow(
                esc(p.name),
                failing
                  ? `${esc(p.error ?? "No valid answer")}<br><span style="color:${C.muted};">${p.isActive ? "In use" : "Paused"} · last OK ${esc(p.lastOkAt ?? "never")}</span>`
                  : esc(p.isActive ? "In use" : "Paused"),
              ),
            )
            .join("")}
          ${metaRow("Checked At", esc(opts.timestamp))}
        </table>
      </td></tr>
      <tr><td>${ctaButton(opts.pageUrl, "Open Proxies")}</td></tr>
    </table>
  `);
}

// ─── AUTH ERRORS ─────────────────────────────────────────────────────────────

export function authErrorsHtml(opts: {
  count: number;
  timestamp: string;
}): string {
  return emailLayout(`
    ${alertBanner("🛡️", "Elevated Auth Error Rate", "#fffbeb")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          <strong>${opts.count} HTTP 5xx errors</strong> were detected on <code style="background:${C.subtle};padding:2px 6px;border-radius:4px;font-size:12px;">/api/auth/*</code> in the last 5 minutes. This may indicate a brute-force attempt or an auth service failure.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Endpoint", "/api/auth/*")}
          ${metaRow("5xx Count (5 min)", `${opts.count}`)}
          ${metaRow("Threshold", "> 5 errors")}
          ${metaRow("Detected At", esc(opts.timestamp))}
        </table>
      </td></tr>
    </table>
  `);
}

// ─── PROBES ──────────────────────────────────────────────────────────────────

/** An account's input read as an injection probe (lib/abuse-signals.ts). */
export function suspiciousInputHtml(opts: {
  merchantName: string;
  merchantEmail: string;
  where: string;
  hits: { field: string; value: string; kind: string }[];
  timestamp: string;
  pageUrl: string;
}): string {
  return emailLayout(`
    ${alertBanner("🛡️", "Probe-like Input", "#fffbeb")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          An account saved text that reads as an injection probe. It was stored as plain text and nothing was executed, but someone may be testing the platform with this account. Review it and suspend it if it isn't a real business. Further probes from this account are not emailed for 6 hours.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Account", `${esc(opts.merchantName)}<br><span style="color:${C.muted};">${esc(opts.merchantEmail)}</span>`)}
          ${metaRow("Where", esc(opts.where))}
          ${opts.hits
            .map((h) => metaRow(esc(h.field), `<code style="font-size:12px;word-break:break-all;">${esc(h.value.slice(0, 200))}</code><br><span style="color:${C.muted};">${esc(h.kind)}</span>`))
            .join("")}
          ${metaRow("Detected At", esc(opts.timestamp))}
        </table>
      </td></tr>
      <tr><td>${ctaButton(opts.pageUrl, "Open account")}</td></tr>
    </table>
  `);
}

/** One or more IPs probing the site (scripts/monitor.ts, lib/probe-traffic.ts). */
export function probeTrafficHtml(opts: {
  offenders: { ip: string; count: number; topPaths: string[] }[];
  windowMinutes: number;
  threshold: number;
  timestamp: string;
}): string {
  return emailLayout(`
    ${alertBanner("🛡️", "API Probing Detected", "#fffbeb")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          More than ${opts.threshold} API requests answered with a client error came from one address in ${opts.windowMinutes} minutes. That is someone fuzzing endpoints, guessing routes or enumerating accounts, or a merchant integration that is badly broken. fail2ban challenges the address at Cloudflare once it reaches 60. Review any account it signed up. Scanner sweeps for files like <code>/.env</code> are not emailed: the routine report counts them. At most one of these emails goes out an hour.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${opts.offenders
            .map((o) => metaRow(esc(o.ip), `<strong>${o.count} requests</strong><br><span style="color:${C.muted};font-size:12px;">${o.topPaths.map(esc).join("<br>")}</span>`))
            .join("")}
          ${metaRow("Detected At", esc(opts.timestamp))}
        </table>
      </td></tr>
    </table>
  `);
}

// ─── WORKER CRASH ────────────────────────────────────────────────────────────

export function workerCrashHtml(opts: {
  type: string;
  message: string;
  stack: string;
  timestamp: string;
}): string {
  return emailLayout(`
    ${alertBanner("💥", `Worker Crash: ${esc(opts.type)}`, "#fff1f1")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          The payment worker encountered an unhandled <strong>${esc(opts.type)}</strong>. The container will restart automatically via Docker.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Error Type", esc(opts.type))}
          ${metaRow("Message", `<span style="color:${C.red};font-size:13px;">${esc(opts.message)}</span>`)}
          ${metaRow("Crashed At", esc(opts.timestamp))}
        </table>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        ${codeBlock("Stack Trace", esc(opts.stack), C.body)}
      </td></tr>
    </table>
  `);
}

// ─── POLL TRACKING FAILURE ──────────────────────────────────────────────────

export function pollTrackingFailureHtml(opts: {
  paymentId: string;
  chain: string | null;
  token: string | null;
  walletAddress: string | null;
  expectedAmount: number;
  xrpDestinationTag?: string | null;
  failureCount: number;
  errorMessage: string;
  errorStack?: string;
  timestamp: string;
  dashboardUrl?: string;
}): string {
  const tagRow = opts.xrpDestinationTag
    ? metaRow(
        "XRP Dest. Tag",
        `<code style="background:${C.subtle};padding:2px 8px;border-radius:4px;font-size:13px;font-weight:600;">${esc(opts.xrpDestinationTag)}</code>`,
      )
    : "";
  const dashboardLink = opts.dashboardUrl
    ? `<tr><td style="padding:16px 0 0;">${ctaButton(opts.dashboardUrl, "View Payment in Dashboard")}</td></tr>`
    : "";

  return emailLayout(`
    ${alertBanner("🔴", "Payment Tracking Failure", "#fff1f1")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          The payment worker has failed to track payment <strong>${esc(opts.paymentId)}</strong> after <strong>${opts.failureCount} consecutive attempts</strong>. This may indicate an invalid wallet address, network connectivity issues, or an RPC provider outage.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 16px;">
        <div style="color:${C.faint};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px;">Payment Details</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Payment ID", `<code style="font-size:12px;word-break:break-all;">${esc(opts.paymentId)}</code>`)}
          ${metaRow("Chain", esc(opts.chain || "Not set"))}
          ${metaRow("Token", esc(opts.token || "Not set"))}
          ${metaRow("Wallet Address", `<code style="font-size:12px;word-break:break-all;">${esc(opts.walletAddress || "Not set")}</code>`)}
          ${metaRow("Expected Amount", amt(opts.expectedAmount, opts.token))}
          ${tagRow}
          ${metaRow("Consecutive Failures", `<span style="color:${C.red};font-weight:600;">${opts.failureCount}</span>`)}
          ${metaRow("Detected At", esc(opts.timestamp))}
        </table>
      </td></tr>
      <tr><td style="padding:0 0 16px;">
        ${codeBlock(
            "Error Details",
            esc(opts.errorMessage),
            C.red,
            opts.errorStack
              ? `<pre style="margin:10px 0 0;color:${C.muted};font-family:${MONO};font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;">${esc(opts.errorStack)}</pre>`
              : "",
          )}
      </td></tr>
      ${dashboardLink}
    </table>
  `);
}

// ─── SERVICE LIFECYCLE ───────────────────────────────────────────────────────

export function lifecycleHtml(opts: {
  service: string;
  event: "starting" | "shutdown";
  detail?: string;
  timestamp: string;
}): string {
  const isStarting = opts.event === "starting";
  const icon = isStarting ? "🟢" : "🟡";
  const title = isStarting
    ? `${esc(opts.service)} Started`
    : `${esc(opts.service)} Shutting Down`;
  const color = isStarting ? "#f0fdf4" : "#fffbeb";
  const description = isStarting
    ? `<strong>${esc(opts.service)}</strong> has started successfully and is ready to handle requests.`
    : `<strong>${esc(opts.service)}</strong> is performing a graceful shutdown. In-flight operations will be completed before exit.`;

  return emailLayout(`
    ${alertBanner(icon, title, color)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">${description}</p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Service", esc(opts.service))}
          ${metaRow("Event", isStarting ? statusBadge("Started", C.green, "#dcfce7") : statusBadge("Shutting Down", C.orange, "#fff7ed"))}
          ${metaRow("Time", esc(opts.timestamp))}
          ${opts.detail ? metaRow("Detail", esc(opts.detail)) : ""}
        </table>
      </td></tr>
    </table>
  `);
}

// ─── STACK STARTUP REPORT ────────────────────────────────────────────────────

export interface ServiceStartupStatus {
  name: string;
  status: "online" | "unreachable";
  responseTime?: number;
}

export function stackStartupHtml(opts: {
  timestamp: string;
  services: ServiceStartupStatus[];
}): string {
  const allOnline = opts.services.every((s) => s.status === "online");
  const icon = allOnline ? "🟢" : "⚠️";
  const title = allOnline
    ? "All Systems Online"
    : "Stack Started: Some Services Unreachable";
  const bannerColor = allOnline ? "#f0fdf4" : "#fffbeb";

  const rows = opts.services
    .map((s) => {
      const isUp = s.status === "online";
      const badge = statusBadge(
        isUp ? "Online" : "Unreachable",
        isUp ? C.green : C.orange,
        isUp ? "#dcfce7" : "#fff7ed",
      );
      const rt =
        s.responseTime !== undefined
          ? `<span style="color:${C.muted};font-size:12px;margin-left:8px;">${s.responseTime}ms</span>`
          : "";
      return `<tr>
      <td style="padding:12px 0;border-bottom:1px solid ${C.border};">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="color:${C.heading};font-size:14px;font-weight:600;">${esc(s.name)}${rt}</td>
          <td style="text-align:right;">${badge}</td>
        </tr></table>
      </td>
    </tr>`;
    })
    .join("");

  return emailLayout(`
    ${alertBanner(icon, title, bannerColor)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          Crypteo stack has started. Here is the status of all services as of <strong>${esc(opts.timestamp)}</strong>.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${rows}
        </table>
      </td></tr>
    </table>
  `);
}

// ─── ROUTINE REPORT ──────────────────────────────────────────────────────────

export function routineReportHtml(opts: {
  timestamp: string;
  nextReportHours: number;
  /** Since the last report: scanner sweeps (counted, never emailed) and API probing (emailed). */
  probes: { scannerRequests: number; scannerIps: number; apiProbeIps: number };
  app: {
    status: "UP" | "DOWN";
    uptime: string;
    lastResponseTime: number;
    totalChecks: number;
    totalFailures: number;
  };
  nginx: {
    status: "UP" | "DOWN";
    uptime: string;
    lastResponseTime: number;
    totalChecks: number;
    totalFailures: number;
  };
  // Reported even when green — it is the line that corresponds to revenue.
  chains?: {
    healthy: boolean | null;
    checkedAt: string | null;
    degraded: string[];
  };
}): string {
  function serviceCard(name: string, s: typeof opts.app): string {
    const isUp = s.status === "UP";
    return `
      <td style="width:50%;padding:0 8px 0 0;vertical-align:top;">
        <div style="background-color:${C.subtle};border:1px solid ${C.border};border-radius:12px;padding:20px;border-top:3px solid ${isUp ? C.green : C.red};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr>
            <td style="font-size:14px;font-weight:600;color:${C.heading};">${name}</td>
            <td align="right">${statusBadge(s.status, isUp ? C.green : C.red, isUp ? "#dcfce7" : "#fff1f1")}</td>
          </tr></table>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:4px 0;color:${C.muted};font-size:12px;">Uptime</td>
              <td style="padding:4px 0;color:${C.heading};font-size:12px;font-weight:600;text-align:right;">${esc(s.uptime)}%</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:${C.muted};font-size:12px;">Response</td>
              <td style="padding:4px 0;color:${C.heading};font-size:12px;font-weight:600;text-align:right;">${s.lastResponseTime}ms</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:${C.muted};font-size:12px;">Checks</td>
              <td style="padding:4px 0;color:${C.heading};font-size:12px;font-weight:600;text-align:right;">${s.totalChecks}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:${C.muted};font-size:12px;">Failures</td>
              <td style="padding:4px 0;color:${s.totalFailures > 0 ? C.red : C.green};font-size:12px;font-weight:600;text-align:right;">${s.totalFailures}</td>
            </tr>
          </table>
        </div>
      </td>`;
  }

  return emailLayout(`
    ${alertBanner("📊", "Routine Monitor Report", "#f0f9ff")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          Scheduled infrastructure health summary for <strong>${esc(opts.timestamp)}</strong>.
        </p>
      </td></tr>
      <tr>
        <td style="padding:0 0 24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${serviceCard("App Server", opts.app)}
              ${serviceCard("Nginx Proxy", opts.nginx)}
            </tr>
          </table>
        </td>
      </tr>
      ${divider()}
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0 0 8px;color:${C.heading};font-size:13px;font-weight:600;">Chain read readiness</p>
        <p style="margin:0;color:${
          opts.chains?.healthy === false ? C.red : C.body
        };font-size:13px;line-height:1.6;">
          ${
            opts.chains?.healthy === true
              ? `All chain/token balance reads healthy (probed ${esc(opts.chains.checkedAt ?? "n/a")}).`
              : opts.chains?.healthy === false
                ? `<strong>Cannot read: ${esc(opts.chains.degraded.join(", "))}</strong>. Deposits on these pairs are NOT being detected.`
                : "No readiness data reported by the worker."
          }
        </p>
      </td></tr>
      ${divider()}
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0 0 8px;color:${C.heading};font-size:13px;font-weight:600;">Probe traffic since the last report</p>
        <p style="margin:0;color:${C.body};font-size:13px;line-height:1.6;">
          ${opts.probes.scannerRequests} scanner requests (<code>/.env</code>, <code>.php</code> and the like) from ${opts.probes.scannerIps} addresses, challenged by fail2ban and never emailed. API probing from ${opts.probes.apiProbeIps} addresses, each already emailed.
        </p>
      </td></tr>
      ${divider()}
      <tr><td>
        <p style="margin:0;color:${C.muted};font-size:12px;">Next report in about ${Math.round(opts.nextReportHours)} hours.</p>
      </td></tr>
    </table>
  `);
}

// ─── PAYMENT SUCCESS (MERCHANT) ───────────────────────────────────────────────

export function paymentSuccessHtml(opts: {
  merchantName: string;
  paymentId: string;
  externalId?: string | null;
  chain: string;
  token: string;
  expectedAmount: number;
  receivedAmount: number;
  txHash?: string | null;
  walletAddress: string;
  customerEmail?: string | null;
  createdAt: string;
  confirmedAt: string;
  dashboardUrl: string;
}): string {
  const overpaid = opts.receivedAmount > opts.expectedAmount;
  const diff = Math.abs(opts.receivedAmount - opts.expectedAmount);

  return emailLayout(`
    ${alertBanner("✅", "Payment Received", "#f0fdf4")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          Hi <strong>${esc(opts.merchantName)}</strong>, a payment has been confirmed on your account.
          ${overpaid ? `<br/><span style="color:${C.sky};font-size:13px;">Note: Customer overpaid by ${amt(diff, opts.token)}.</span>` : ""}
        </p>
      </td></tr>

      <tr><td style="padding:0 0 8px;">
        <div style="color:${C.faint};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px;">Payment Summary</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Status", statusBadge("Confirmed", C.green, "#dcfce7"))}
          ${metaRow("Amount Received", `<strong style="font-size:15px;color:${C.heading};">${amt(opts.receivedAmount, opts.token)}</strong>`)}
          ${metaRow("Amount Expected", amt(opts.expectedAmount, opts.token))}
          ${metaRow("Network", esc(opts.chain.toUpperCase()))}
          ${metaRow("Wallet Address", `<code style="font-size:11px;word-break:break-all;color:${C.body};">${esc(opts.walletAddress)}</code>`)}
          ${opts.txHash ? metaRow("Transaction Hash", `<code style="font-size:11px;word-break:break-all;color:${C.sky};">${esc(opts.txHash)}</code>`) : ""}
          ${opts.externalId ? metaRow("Your Reference", `<code style="font-size:12px;">${esc(opts.externalId)}</code>`) : ""}
          ${opts.customerEmail ? metaRow("Customer Email", esc(opts.customerEmail)) : ""}
          ${metaRow("Payment ID", `<code style="font-size:11px;">${esc(opts.paymentId)}</code>`)}
          ${metaRow("Created", esc(opts.createdAt))}
          ${metaRow("Confirmed", esc(opts.confirmedAt))}
        </table>
      </td></tr>

      <tr><td style="padding:20px 0 0;">
        ${ctaButton(opts.dashboardUrl, "View in Dashboard")}
      </td></tr>
    </table>
  `, "Payment Notifications");
}

// ─── PAYMENT UNDERPAID (MERCHANT) ─────────────────────────────────────────────

export function paymentUnderpaidHtml(opts: {
  merchantName: string;
  paymentId: string;
  externalId?: string | null;
  chain: string;
  token: string;
  expectedAmount: number;
  receivedAmount: number;
  shortfall: number;
  txHash?: string | null;
  walletAddress: string;
  customerEmail?: string | null;
  createdAt: string;
  dashboardUrl: string;
}): string {
  // An "underpaid" notice with nothing received is a detection fault, not a
  // customer short-paying — "request the remaining X or refund the received
  // amount" would have the merchant chase or refund money that never arrived.
  const noFunds = !(opts.receivedAmount > 0);
  const order = esc(opts.externalId || opts.paymentId);
  const intro = noFunds
    ? `Hi <strong>${esc(opts.merchantName)}</strong>, payment for order <strong>${order}</strong> was flagged as underpaid, but <strong>no funds were detected</strong> on-chain for it. Nothing has been credited. Please check the transaction before contacting the customer.`
    : `Hi <strong>${esc(opts.merchantName)}</strong>, a payment was received for order <strong>${order}</strong> but the amount was <strong>less than expected</strong>. This payment has <strong>not been credited</strong>. Please contact the customer to resolve.`;
  const contact = opts.customerEmail
    ? ` at <strong>${esc(opts.customerEmail)}</strong>`
    : "";
  const advice = noFunds
    ? `💡 <strong>What to do:</strong> No funds were detected for this payment, so there is nothing to refund. Verify on-chain whether the customer sent anything${contact ? `, and contact the customer${contact} if needed` : ""}.`
    : `💡 <strong>What to do:</strong> Contact the customer${contact} and request the remaining <strong>${amt(opts.shortfall, opts.token)}</strong>, or issue a refund for the received amount.`;

  return emailLayout(`
    ${alertBanner("⚠️", "Underpaid: Action Required", "#fffbeb")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          ${intro}
        </p>
      </td></tr>

      <tr><td style="padding:0 0 8px;">
        <div style="color:${C.faint};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px;">Payment Details</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Status", statusBadge("Underpaid", C.orange, "#fff7ed"))}
          ${metaRow("Amount Received", `<strong style="color:${C.orange};">${amt(opts.receivedAmount, opts.token)}</strong>`)}
          ${metaRow("Amount Expected", amt(opts.expectedAmount, opts.token))}
          ${metaRow("Shortfall", `<strong style="color:${C.red};">${amt(opts.shortfall, opts.token)}</strong>`)}
          ${metaRow("Network", esc(opts.chain.toUpperCase()))}
          ${metaRow("Wallet Address", `<code style="font-size:11px;word-break:break-all;color:${C.body};">${esc(opts.walletAddress)}</code>`)}
          ${opts.txHash ? metaRow("Transaction Hash", `<code style="font-size:11px;word-break:break-all;color:${C.body};">${esc(opts.txHash)}</code>`) : ""}
          ${opts.externalId ? metaRow("Your Reference", `<code style="font-size:12px;">${esc(opts.externalId)}</code>`) : ""}
          ${opts.customerEmail ? metaRow("Customer Email", esc(opts.customerEmail)) : ""}
          ${metaRow("Payment ID", `<code style="font-size:11px;">${esc(opts.paymentId)}</code>`)}
          ${metaRow("Created", esc(opts.createdAt))}
        </table>
      </td></tr>

      <tr><td style="padding:16px 0 0;">
        <div style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;">
          <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6;">${advice}</p>
        </div>
      </td></tr>

      <tr><td style="padding:20px 0 0;">
        ${ctaButton(opts.dashboardUrl, "View in Dashboard")}
      </td></tr>
    </table>
  `, "Payment Notifications");
}

// ─── PAYMENT EXPIRED (MERCHANT) ───────────────────────────────────────────────

export function paymentExpiredHtml(opts: {
  merchantName: string;
  paymentId: string;
  externalId?: string | null;
  chain: string;
  token: string;
  expectedAmount: number;
  receivedAmount?: number | null;
  txHash?: string | null;
  walletAddress: string;
  customerEmail?: string | null;
  createdAt: string;
  expiredAt: string;
  hadFunds: boolean;
  dashboardUrl: string;
}): string {
  const title = opts.hadFunds ? "Late Payment Detected, Not Credited" : "Payment Expired";
  const icon = opts.hadFunds ? "🕐" : "⏱️";
  const bannerColor = opts.hadFunds ? "#fff1f1" : C.subtle;

  const description = opts.hadFunds
    ? `Hi <strong>${esc(opts.merchantName)}</strong>, a payment${
        opts.receivedAmount && opts.receivedAmount > 0
          ? ` of <strong>${amt(opts.receivedAmount, opts.token)}</strong>`
          : ""
      } was detected for order <strong>${esc(opts.externalId || opts.paymentId)}</strong> <em>after the payment window had closed</em>. This payment has <strong>not been credited</strong> and requires manual review.`
    : `Hi <strong>${esc(opts.merchantName)}</strong>, the payment window for order <strong>${esc(opts.externalId || opts.paymentId)}</strong> has expired with <strong>no funds received</strong>.`;

  return emailLayout(`
    ${alertBanner(icon, title, bannerColor)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">${description}</p>
      </td></tr>

      <tr><td style="padding:0 0 8px;">
        <div style="color:${C.faint};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px;">Payment Details</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Status", opts.hadFunds ? statusBadge("Late Payment", C.red, "#fff1f1") : statusBadge("Expired", C.muted, C.border))}
          ${metaRow("Amount Expected", amt(opts.expectedAmount, opts.token))}
          ${opts.hadFunds && opts.receivedAmount ? metaRow("Amount Received", `<strong style="color:${C.orange};">${amt(opts.receivedAmount, opts.token)}</strong>`) : ""}
          ${metaRow("Network", esc(opts.chain.toUpperCase()))}
          ${metaRow("Wallet Address", `<code style="font-size:11px;word-break:break-all;color:${C.body};">${esc(opts.walletAddress)}</code>`)}
          ${opts.txHash ? metaRow("Transaction Hash", `<code style="font-size:11px;word-break:break-all;color:${C.body};">${esc(opts.txHash)}</code>`) : ""}
          ${opts.externalId ? metaRow("Your Reference", `<code style="font-size:12px;">${esc(opts.externalId)}</code>`) : ""}
          ${opts.customerEmail ? metaRow("Customer Email", esc(opts.customerEmail)) : ""}
          ${metaRow("Payment ID", `<code style="font-size:11px;">${esc(opts.paymentId)}</code>`)}
          ${metaRow("Created", esc(opts.createdAt))}
          ${metaRow("Expired At", esc(opts.expiredAt))}
        </table>
      </td></tr>

      ${opts.hadFunds ? `
      <tr><td style="padding:16px 0 0;">
        <div style="background-color:#fff1f1;border:1px solid #fecaca;border-radius:10px;padding:14px 18px;">
          <p style="margin:0;color:#991b1b;font-size:13px;line-height:1.6;">⚠️ <strong>Manual action required:</strong> Funds were received outside the payment window. You must decide whether to credit this payment manually or refund the customer.</p>
        </div>
      </td></tr>` : ""}

      <tr><td style="padding:20px 0 0;">
        ${ctaButton(opts.dashboardUrl, "View in Dashboard")}
      </td></tr>
    </table>
  `, "Payment Notifications");
}

// ─── ACCOUNT SECURITY CHANGE (MERCHANT) ───────────────────────────────────────

/**
 * Sent when something that controls where money goes (a receiving address) or
 * who can act on the account (an API key) changes. A stolen dashboard session
 * can do either silently; this makes it visible to the account owner.
 */
export function accountSecurityChangeHtml(opts: {
  merchantName: string;
  action: string;
  details: { label: string; value: string }[];
  time: string;
  ip: string;
  dashboardUrl: string;
}): string {
  return emailLayout(`
    ${alertBanner("🔐", esc(opts.action), "#eff6ff")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          Hi <strong>${esc(opts.merchantName)}</strong>, a security-relevant change was just made on your Crypteo account.
        </p>
      </td></tr>

      <tr><td style="padding:0 0 8px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${opts.details.map((d) => metaRow(esc(d.label), `<code style="font-size:12px;word-break:break-all;">${esc(d.value)}</code>`)).join("")}
          ${metaRow("Time (UTC)", esc(opts.time))}
          ${metaRow("From IP", esc(opts.ip))}
        </table>
      </td></tr>

      <tr><td style="padding:16px 0 0;">
        <div style="background-color:#fff1f1;border:1px solid #fecaca;border-radius:10px;padding:14px 18px;">
          <p style="margin:0;color:#991b1b;font-size:13px;line-height:1.6;">
            <strong>Not you?</strong> Someone may have access to your account. Change your password immediately (this signs out every other session), then review your receiving wallets and revoke any API keys you don't recognise.
          </p>
        </div>
      </td></tr>

      <tr><td style="padding:20px 0 0;">
        ${ctaButton(opts.dashboardUrl, "Review Account")}
      </td></tr>
    </table>
  `, "Account Security");
}

/** A one-time code email (login, password reset, registration). */
export function otpCodeHtml(opts: {
  title: string;
  intro: string;
  code: string;
  footer: string;
}): string {
  return emailLayout(
    `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:32px 0 12px;">
        <h1 style="margin:0;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:600;color:${C.heading};letter-spacing:-0.02em;">${esc(opts.title)}</h1>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <p style="margin:0;color:${C.body};font-size:15px;line-height:1.6;">${esc(opts.intro)}</p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          <tr><td align="center" style="padding:22px 16px;font-family:${MONO};font-size:32px;font-weight:700;letter-spacing:8px;color:${C.heading};">${esc(opts.code)}</td></tr>
        </table>
      </td></tr>
      <tr><td>
        <p style="margin:0;color:${C.muted};font-size:13px;line-height:1.6;">${esc(opts.footer)}</p>
      </td></tr>
    </table>
  `,
    "Account",
  );
}

/** An account was given admin access: every admin hears of it. */
export function adminAccessGrantedHtml(opts: {
  accountName: string;
  accountEmail: string;
  grantedBy: string;
  ip: string;
  timestamp: string;
  pageUrl: string;
}): string {
  return emailLayout(`
    ${alertBanner("🛡️", "Admin Access Granted", "#fffbeb")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          An account can now view and change every account on the platform. The admin who granted it confirmed their password. If nobody on the team expected this, remove the access and sign that admin out everywhere.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("New admin", `${esc(opts.accountName)}<br><span style="color:${C.muted};">${esc(opts.accountEmail)}</span>`)}
          ${metaRow("Granted by", esc(opts.grantedBy))}
          ${metaRow("From IP", esc(opts.ip))}
          ${metaRow("Time (UTC)", esc(opts.timestamp))}
        </table>
      </td></tr>
      <tr><td>${ctaButton(opts.pageUrl, "Open account")}</td></tr>
    </table>
  `);
}

// ─── ORPHAN TRANSACTION (ADMIN) ───────────────────────────────────────────────

export function orphanDetectedHtml(opts: {
  txHash: string;
  receivedAmount: number;
  token: string;
  chain: string;
  walletAddress: string;
  blockTime: string | null;
  dashboardUrl: string | null;
}): string {
  return emailLayout(`
    ${alertBanner("⚠️", "Unmatched Transaction Detected", "#fffbeb")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          A deposit arrived that no open payment session could claim. It needs a manual review: credit it to the right session or dismiss it.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Amount", `<strong>${amt(opts.receivedAmount, opts.token.toUpperCase())}</strong>`)}
          ${metaRow("Network", esc(opts.chain.toUpperCase()))}
          ${metaRow("Wallet", `<code style="font-family:${MONO};font-size:11px;word-break:break-all;">${esc(opts.walletAddress)}</code>`)}
          ${metaRow("Transaction", `<code style="font-family:${MONO};font-size:11px;word-break:break-all;">${esc(opts.txHash)}</code>`)}
          ${metaRow("Block time", esc(opts.blockTime ?? "–"))}
        </table>
      </td></tr>
      ${opts.dashboardUrl ? `<tr><td>${ctaButton(opts.dashboardUrl, "Review orphans")}</td></tr>` : ""}
    </table>
  `);
}

// ─── PLATFORM FEES (MERCHANT) ─────────────────────────────────────────────────

/** A fee invoice, its reminders, the billing hold and its release. */
export function billingNoticeHtml(opts: {
  merchantName: string;
  title: string;
  /** Plain sentences, escaped here. */
  lines: string[];
  tone: "info" | "warning" | "danger" | "success";
  rows: { label: string; value: string }[];
  billingUrl: string;
  cta: string;
}): string {
  const tones = {
    info: ["🧾", "#eff6ff"],
    warning: ["⏳", "#fff7ed"],
    danger: ["⛔", "#fef2f2"],
    success: ["✅", "#f0fdf4"],
  } as const;
  const [icon, bg] = tones[opts.tone];
  return emailLayout(
    `
    ${alertBanner(icon, esc(opts.title), bg)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0 0 10px;color:${C.body};font-size:14px;line-height:1.6;">Hi <strong>${esc(opts.merchantName)}</strong>,</p>
        ${opts.lines.map((l) => `<p style="margin:0 0 10px;color:${C.body};font-size:14px;line-height:1.6;">${esc(l)}</p>`).join("")}
      </td></tr>
      <tr><td style="padding:0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${opts.rows.map((r) => metaRow(esc(r.label), esc(r.value))).join("")}
        </table>
      </td></tr>
      <tr><td>${ctaButton(opts.billingUrl, esc(opts.cta))}</td></tr>
    </table>
  `,
    "Billing",
  );
}

// ─── ADMIN MESSAGE (MERCHANT) ─────────────────────────────────────────────────

/** A message an admin wrote to a merchant. Plain text: escaped, line breaks kept. */
export function adminMessageHtml(opts: {
  merchantName: string;
  subject: string;
  message: string;
  dashboardUrl: string;
}): string {
  const paragraphs = opts.message
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;color:${C.body};font-size:14px;line-height:1.7;">${esc(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return emailLayout(
    `
    ${alertBanner("✉️", esc(opts.subject), "#f1f5f9")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0 0 12px;color:${C.body};font-size:14px;line-height:1.6;">Hi <strong>${esc(opts.merchantName)}</strong>,</p>
        ${paragraphs}
        <p style="margin:12px 0 0;color:${C.muted};font-size:13px;">The Crypteo team</p>
      </td></tr>
      <tr><td>${ctaButton(opts.dashboardUrl, "Open dashboard")}</td></tr>
    </table>
  `,
    "Message from Crypteo",
  );
}

// ─── TEST PAYMENT (MERCHANT, SANDBOX) ─────────────────────────────────────────

/** Sent when a test-mode session is confirmed through the simulate endpoint. */
export function testPaymentHtml(opts: {
  merchantName: string;
  paymentId: string;
  amount: number;
  token: string | null;
  customerEmail?: string | null;
  dashboardUrl: string;
}): string {
  return emailLayout(
    `
    ${alertBanner("🧪", "Test Payment Received", "#eff6ff")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <p style="margin:0;color:${C.body};font-size:14px;line-height:1.6;">
          Hi <strong>${esc(opts.merchantName)}</strong>, a test payment was just confirmed on your Crypteo account.
        </p>
      </td></tr>
      <tr><td style="padding:0 0 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Status", statusBadge("Test", C.blue, "#e0f2fe"))}
          ${metaRow("Amount", `<strong style="font-size:15px;color:${C.heading};">${esc(opts.amount)} ${esc(opts.token?.toUpperCase() || "")}</strong>`)}
          ${metaRow("Customer", esc(opts.customerEmail || "N/A"))}
          ${metaRow("Invoice ID", `<code style="font-size:11px;">${esc(opts.paymentId)}</code>`)}
        </table>
      </td></tr>
      <tr><td style="padding:0 0 24px;">${ctaButton(opts.dashboardUrl, "View in dashboard")}</td></tr>
      <tr><td>
        <p style="margin:0;color:${C.muted};font-size:13px;line-height:1.6;">This is a test-mode notification. No real funds were transferred.</p>
      </td></tr>
    </table>
  `,
    "Test Mode",
  );
}

// ─── CONTACT FORM (PLATFORM INBOX) ────────────────────────────────────────────

/** A contact-form submission, to the platform's own inbox. */
export function contactMessageHtml(opts: {
  name: string;
  email: string;
  subject: string;
  message: string;
}): string {
  return emailLayout(
    `
    ${alertBanner("📨", "New Contact Form Message", "#eff6ff")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="${SUMMARY_TABLE}">
          ${metaRow("Name", esc(opts.name))}
          ${metaRow("Email", esc(opts.email))}
          ${metaRow("Subject", esc(opts.subject || "–"))}
        </table>
      </td></tr>
      <tr><td>
        <p style="margin:0;color:${C.heading};font-size:14px;line-height:1.7;">${esc(opts.message).replace(/\n/g, "<br/>")}</p>
      </td></tr>
    </table>
  `,
    "Contact Form",
  );
}
