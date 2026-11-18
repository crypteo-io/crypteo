/**
 * Text that reads as an injection probe rather than a business's copy. On
 * 2026-10-23 a fuzzer created payment links titled `probe'`, `probe''`,
 * `probe"` and `probe or 1=1`. Every value is stored and rendered safely
 * (parameterised queries, escaped output), so a match is never refused: it
 * tells admins someone is testing the platform with a real account.
 */
const PROBES: { label: string; pattern: RegExp }[] = [
  { label: "SQL injection", pattern: /\b(or|and)\s+['"]?\d+['"]?\s*=\s*['"]?\d+|\bunion\s+(all\s+)?select\b|;\s*(drop|delete|insert|update|select)\s|\b(pg_)?sleep\s*\(|\bwaitfor\s+delay\b|\bbenchmark\s*\(|\binformation_schema\b|['"]\s*(--|#)/i },
  { label: "quote fuzzing", pattern: /^[^'"]*\w(['"])\1?$/ },
  { label: "script injection", pattern: /<\s*\/?\s*(script|img|svg|iframe|body)\b|\bon[a-z]+\s*=|javascript\s*:/i },
  { label: "template injection", pattern: /\{\{[^}]*\}\}|\$\{[^}]*\}|<%[^%]*%>/ },
  { label: "path traversal", pattern: /\.\.[/\\]/ },
];

/**
 * Characters of a value that are checked. A probe shows itself early; the
 * template pattern was quadratic on an unbounded title, and 1 MB of "{{"
 * would have held the event loop for about 25 minutes (pen-test 2026-11-15).
 */
const PROBE_SCAN_CHARS = 1_000;

/** What a value looks like a probe for, or null when it reads as ordinary text. */
export function probeKind(value: string): string | null {
  const head = value.trim().slice(0, PROBE_SCAN_CHARS);
  return PROBES.find((p) => p.pattern.test(head))?.label ?? null;
}

/**
 * Probes certain enough to suspend an account on sight (lib/account-risk.ts).
 * probeKind above only flags for an admin, so it can afford to be loose;
 * these must never match a real business's text or URL (user, 2026-11-16:
 * "no false positives"). Each needs the shape of a working payload, not just
 * a keyword: `sleep(` alone is a product name, `pg_sleep(5)` is not. Guarded
 * by lib/probe-patterns.test.ts, which runs both real probes from the access
 * logs and ordinary merchant copy through them.
 */
const CERTAIN_PROBES: { label: string; pattern: RegExp }[] = [
  {
    label: "SQL injection",
    pattern: new RegExp(
      [
        String.raw`\bpg_sleep\s*\(\s*\d`,
        String.raw`\bwaitfor\s+delay\s+'\d`,
        String.raw`\bbenchmark\s*\(\s*\d+\s*,`,
        String.raw`\bsleep\s*\(\s*\d+\s*\)\s*(--|#|\)|'|"|\|\||\+|$)`,
        String.raw`['"\)]\s*(or|and)\s+['"]?\w+['"]?\s*=\s*['"]?\w+`,
        String.raw`\bunion\s+(all\s+)?select\s+(null|\d|@@|\*|concat|char|version|user\b)`,
        String.raw`\binformation_schema\s*\.`,
        String.raw`\b(extractvalue|updatexml|load_file)\s*\(`,
        String.raw`;\s*(drop\s+table|shutdown\b|select\s+pg_sleep)`,
      ].join("|"),
      "i",
    ),
  },
  {
    label: "script injection",
    pattern: /<\s*script\b|<\s*(img|svg|body|iframe|video|audio)\b[^>]*\bon[a-z]+\s*=|<\s*iframe\b[^>]*\bsrc\s*=\s*['"]?\s*javascript:/i,
  },
  {
    label: "template injection",
    pattern: /\{\{\s*\d+\s*\*\s*\d+\s*\}\}|\$\{\s*\d+\s*\*\s*\d+\s*\}|<%=?\s*\d+\s*\*\s*\d+\s*%>|\{\{[^}]*\b(constructor|__proto__|config|self\.__init__)\b[^}]*\}\}/i,
  },
  {
    label: "path traversal",
    pattern: /(\.\.[/\\]){2,}|\/etc\/(passwd|shadow|hosts)\b|\bwin\.ini\b|\.\.%2f|%2e%2e[/%]/i,
  },
];

/** The probe a value certainly is, or null. First PROBE_SCAN_CHARS only, like probeKind. */
export function certainProbe(value: string): string | null {
  const head = value.trim().slice(0, PROBE_SCAN_CHARS);
  return CERTAIN_PROBES.find((p) => p.pattern.test(head))?.label ?? null;
}
