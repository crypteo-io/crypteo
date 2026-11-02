import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceFiles } from "./testing/source-files";

vi.mock("./mailer", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));

import { adminRecipients, sendAdminAlert } from "./admin-alerts";
import { sendEmail } from "./mailer";

const files = sourceFiles(["app", "lib", "workers", "scripts", "instrumentation.ts"]);

/**
 * Operational alerts (poll failures, orphans, outages, crashes) carry stack
 * traces, endpoints and other merchants' payments, and go to ADMIN_EMAILS only.
 * Mail to a merchant is limited to their own payments, account security and
 * sign-in codes, sent from the files below.
 */
describe("operational alerts reach ADMIN_EMAILS only", () => {
  it("reads ADMIN_EMAILS in exactly one place", () => {
    expect(
      files.filter((f) => f.text.includes("process.env.ADMIN_EMAILS")).map((f) => f.path),
    ).toEqual(["lib/admin-alerts.ts"]);
  });

  it("sends mail directly only from the reviewed senders", () => {
    const MAIL_SENDERS = [
      "app/api/auth/forgot-password/route.ts", // reset code to the account owner
      "app/api/auth/register/otp/route.ts", // registration code to the new account
      "app/api/auth/verify/resend/route.ts", // verification code to the account owner
      "lib/billing/notices.ts", // the merchant's own fee invoices and holds
      "app/api/payments/[id]/simulate/route.ts", // test payment notice to its merchant
      "lib/admin-alerts.ts", // ADMIN_EMAILS
      "lib/mailer.ts", // transport, account security notices and admin messages to the owner
      "lib/payment/notify.ts", // the merchant's own payment outcomes
      "lib/two-factor.ts", // sign-in and wallet-change codes to the account owner
      "scripts/test-mail.ts", // manual diagnostic to the first admin
    ];
    const senders = files
      .filter((f) => /\bsendEmail(ToEach)?\s*\(/.test(f.text))
      .map((f) => f.path)
      .sort();
    expect(senders).toEqual([...MAIL_SENDERS].sort());
  });

  it("uses the raw transport only where sendEmail can't express the mail", () => {
    const RAW = [
      "app/api/contact/route.ts", // to the platform inbox, Reply-To the visitor
      "lib/mailer.ts",
    ];
    expect(
      files.filter((f) => /\btransporter\.sendMail\s*\(/.test(f.text)).map((f) => f.path).sort(),
    ).toEqual(RAW.sort());
  });
});

describe("sendAdminAlert", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends to every ADMIN_EMAILS address", async () => {
    vi.stubEnv("ADMIN_EMAILS", " ops@example.com, oncall@example.com ,");
    expect(adminRecipients()).toEqual(["ops@example.com", "oncall@example.com"]);
    expect(await sendAdminAlert("s", "<p>h</p>")).toBe(true);
    expect(vi.mocked(sendEmail).mock.calls.at(-1)?.[0].to).toBe(
      "ops@example.com,oncall@example.com",
    );
  });

  it("sends nothing when no admin is configured", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    vi.mocked(sendEmail).mockClear();
    expect(await sendAdminAlert("s", "<p>h</p>")).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
