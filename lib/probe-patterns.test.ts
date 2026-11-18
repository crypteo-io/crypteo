import { describe, expect, it } from "vitest";
import { certainProbe, probeKind } from "./probe-patterns";

// Payloads the 2026-10-23, 11-13 and 11-15 probers actually sent (access logs,
// contact form, sign-up names). Every one must suspend.
const REAL_PROBES = [
  "x' OR SLEEP(6)--",
  "Test' OR pg_sleep(6)--",
  "'; SELECT pg_sleep(6)--",
  "1; WAITFOR DELAY '0:0:6'--",
  '" OR SLEEP(6)--',
  "1) AND SLEEP(6)--",
  "1); SELECT pg_sleep(5)--",
  "cmpay0000000000000000test' OR '1'='1",
  "cmpay0000000000000000test' UNION SELECT NULL--",
  "c'+SLEEP(3)+'",
  "Alex'||pg_sleep(8)||'",
  "x' AND SLEEP(8)",
  "' OR 1=1#",
  "' OR '1'='2' -- -",
  "{{7*7}}",
  "${7*7}",
  "<% 7*7 %>",
  "{{constructor.constructor('return 1')()}}",
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "<svg onload=alert(1)>",
  "../../etc/passwd",
  "/api/admin/merchants%2e%2e/merchants",
];

// Copy a real merchant might write. Any match here suspends a real business,
// so each one that trips the loose flag (probeKind) must still pass here.
const REAL_COPY = [
  "Sleep (Deluxe) mask",
  "Rock 'n' Roll Tickets",
  "Union Select Wines",
  "Hello {{order_id}}, thanks for your order",
  "See ../docs for setup",
  "/dashboard?onboarding=1",
  'Size 10" -- limited stock',
  "Joe's Coffee",
  "O'Reilly Media",
  "JavaScript: The Good Parts",
  "<b>Sale</b> today",
  "Buy 2 and get 1=1 free?",
  "Pay 50% now, 50% later",
  "Premium plan (12 months)",
  "Card 'Gold' or 'Silver'",
  "/api/payments?page=1&limit=50&status=confirmed",
  "Gift card x10 (sleep 8)",
  "template ${price} placeholder",
  "SELECT plan",
  "drop table cloth set; delivery included",
  "Wine & Dine 2024 or 2025=sold out",
  "Game night: Union select team vs. rivals",
  "Fast checkout: no sleep(), just pay",
];

describe("certainProbe", () => {
  it.each(REAL_PROBES)("suspends on %s", (probe) => {
    expect(certainProbe(probe)).not.toBeNull();
  });

  it.each(REAL_COPY)("never suspends on %s", (copy) => {
    expect(certainProbe(copy)).toBeNull();
  });

  it("is stricter than the admin flag: copy the flag catches still passes", () => {
    const flaggedOnly = REAL_COPY.filter((c) => probeKind(c));
    expect(flaggedOnly.length).toBeGreaterThan(3);
    for (const c of flaggedOnly) expect(certainProbe(c), c).toBeNull();
  });
});
