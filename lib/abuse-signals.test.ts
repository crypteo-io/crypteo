import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { notification: { findFirst: vi.fn() }, merchant: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/notifications", () => ({ notifyAdmins: vi.fn(async () => 1) }));
vi.mock("@/lib/admin-alerts", () => ({ sendAdminAlert: vi.fn(async () => true) }));
vi.mock("./account-risk", () => ({ recordRiskEvent: vi.fn(async () => {}) }));

import { sendAdminAlert } from "@/lib/admin-alerts";
import { prisma } from "@/lib/db";
import { notifyAdmins } from "@/lib/notifications";
import { recordRiskEvent } from "./account-risk";
import { flagProbeInput } from "./abuse-signals";
import { probeKind } from "./probe-patterns";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(prisma.notification.findFirst).mockResolvedValue(null);
  mock(prisma.merchant.findUnique).mockResolvedValue({ name: "AcmeProbe", email: "x@example.org" });
});

describe("probeKind", () => {
  it("recognises the payment-link titles a fuzzer created on 2026-10-23", () => {
    for (const title of ["probe'", "probe''", 'probe"', "probe or 1=1"]) {
      expect(probeKind(title), title).not.toBeNull();
    }
  });

  it.each([
    ["' OR '1'='1", "SQL injection"],
    ["x UNION SELECT password FROM users", "SQL injection"],
    ["1; DROP TABLE x", "SQL injection"],
    ["admin'--", "SQL injection"],
    ["<script>alert(1)</script>", "script injection"],
    ['<img src=x onerror=alert(1)>', "script injection"],
    ["{{7*7}}", "template injection"],
    ["${7*7}", "template injection"],
    ["../../etc/passwd", "path traversal"],
  ])("labels %s as %s", (value, label) => {
    expect(probeKind(value)).toBe(label);
  });

  it("leaves ordinary business copy alone", () => {
    for (const text of [
      "probe",
      "Acme Store",
      "O'Brien's Bakery",
      "Order #1042 - 2 items",
      'The "Deluxe" plan',
      "Rock 'n' Roll merch",
      "Pay 1 = 1 coffee",
      "Annual subscription (2026)",
      "Tom & Jerry's",
    ]) {
      expect(probeKind(text), text).toBeNull();
    }
  });
});

describe("flagProbeInput", () => {
  it("notifies admins in-app and by email, naming the field and kind", async () => {
    await flagProbeInput("m1", "Payment link", { title: "probe or 1=1", description: null });
    expect(notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "admin_probe", link: "/merchants/m1", body: expect.stringContaining("title looks like SQL injection") }),
    );
    expect(sendAdminAlert).toHaveBeenCalledOnce();
  });

  it("raises nothing for ordinary input, without touching the database", async () => {
    await flagProbeInput("m1", "Payment link", { title: "Acme Store", description: undefined });
    expect(prisma.notification.findFirst).not.toHaveBeenCalled();
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it("stays quiet when this account was flagged recently", async () => {
    mock(prisma.notification.findFirst).mockResolvedValue({ id: "n1" });
    await flagProbeInput("m1", "Payment link", { title: "probe'" });
    expect(notifyAdmins).not.toHaveBeenCalled();
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it("never throws into the write that carried the input", async () => {
    mock(prisma.notification.findFirst).mockRejectedValue(new Error("db down"));
    await expect(flagProbeInput("m1", "Payment link", { title: "probe'" })).resolves.toBeUndefined();
  });
});

describe("probeKind on hostile lengths (pen-test 2026-11-15)", () => {
  it("stays fast on a megabyte of unclosed template braces", () => {
    for (const value of ["{{".repeat(500_000), "${".repeat(500_000), "<%".repeat(500_000), "'".repeat(1_000_000)]) {
      const started = performance.now();
      probeKind(value);
      expect(performance.now() - started).toBeLessThan(200);
    }
  });
});

describe("flagProbeInput and suspension (no false positives, user 2026-11-16)", () => {
  it("only flags a loose match, never counting it toward suspension", async () => {
    await flagProbeInput("m1", "Payment link", { title: "probe'", description: "Hello {{order_id}}" });
    expect(notifyAdmins).toHaveBeenCalled();
    expect(recordRiskEvent).not.toHaveBeenCalled();
  });

  it("hands a certain probe to the suspension", async () => {
    await flagProbeInput("m1", "Sign-up", { name: "Alex'||pg_sleep(8)||'" });
    expect(recordRiskEvent).toHaveBeenCalledWith("m1", "probe_input", expect.stringContaining("pg_sleep"));
  });
});
