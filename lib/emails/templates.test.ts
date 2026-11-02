import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  adminMessageHtml,
  billingNoticeHtml,
  emailLayout,
  esc,
  otpCodeHtml,
  paymentSuccessHtml,
  paymentUnderpaidHtml,
  safeHref,
  testPaymentHtml,
  workerCrashHtml,
} from "./templates";

const base = {
  merchantName: "Acme",
  paymentId: "pay_1",
  chain: "btc",
  token: "btc",
  expectedAmount: 0.001,
  walletAddress: "bc1qxyz",
  createdAt: "2026-09-30",
  dashboardUrl: "https://crypteo.io/dashboard/payments/pay_1",
};

describe("esc / safeHref", () => {
  it("escapes HTML metacharacters", () => {
    expect(esc(`<img src=x onerror="a('b')">&`)).toBe(
      "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;",
    );
    expect(esc(null)).toBe("");
  });

  it("only allows http(s)/mailto hrefs", () => {
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(safeHref("not a url")).toBe("#");
    expect(safeHref("https://x.io/a?b=1&c=2")).toBe("https://x.io/a?b=1&amp;c=2");
  });
});

describe("payment email templates", () => {
  it("escapes API-controlled fields", () => {
    const html = paymentUnderpaidHtml({
      ...base,
      externalId: "<script>alert(1)</script>",
      customerEmail: '"><b>x</b>@example.com',
      receivedAmount: 0.0005,
      shortfall: 0.0005,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("never prints amounts in exponent notation", () => {
    const html = paymentUnderpaidHtml({
      ...base,
      expectedAmount: 0.0000015,
      receivedAmount: 0.000001,
      shortfall: 5e-7,
    });
    expect(html).not.toMatch(/\de-\d/);
    expect(html).toContain("0.0000005 btc");
    expect(html).not.toContain("0.000000 btc");
  });

  it("does not advise a refund when nothing was received", () => {
    const html = paymentUnderpaidHtml({
      ...base,
      receivedAmount: 0,
      shortfall: 0.001,
    });
    expect(html).toContain("no funds were detected");
    expect(html).not.toContain("issue a refund for the received amount");
  });

  it("escapes error stacks", () => {
    const html = workerCrashHtml({
      type: "Error",
      message: "<i>boom</i>",
      stack: "at <anonymous>",
      timestamp: "now",
    });
    expect(html).toContain("at &lt;anonymous&gt;");
    expect(html).not.toContain("<i>boom</i>");
  });
});

describe("shared email layout", () => {
  it("uses the hosted Crypteo logo and the non-custodial footer", () => {
    const html = emailLayout("<p>hi</p>", "Payment Notifications");
    expect(html).toContain('src="https://crypteo.io/logo-email.png"');
    expect(html).not.toContain("_next/image");
    expect(html).toContain("Crypteo · Non-custodial crypto payments");
    expect(html).toContain("Buyers pay your own wallet directly");
  });

  it("escapes the one-time code and its copy", () => {
    const html = otpCodeHtml({
      title: "<b>t</b>",
      intro: "i",
      code: "<i>123456</i>",
      footer: "f",
    });
    expect(html).not.toContain("<i>123456</i>");
    expect(html).toContain("&lt;i&gt;123456&lt;/i&gt;");
    expect(html).not.toContain("<b>t</b>");
  });

  it("escapes the test payment email's API-controlled fields", () => {
    const html = testPaymentHtml({
      merchantName: "<script>x</script>",
      paymentId: "pay_1",
      amount: 10,
      token: "usdc",
      customerEmail: '"><b>x</b>@example.com',
      dashboardUrl: "https://crypteo.io/dashboard/payments/pay_1",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("10 USDC");
  });

  it("renders dashboard buttons through safeHref", () => {
    const html = paymentUnderpaidHtml({
      ...base,
      dashboardUrl: "javascript:alert(1)",
      receivedAmount: 0.0005,
      shortfall: 0.0005,
    });
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });
});

/**
 * Every email body sits in emailLayout()'s card cell. A bare <tr> there is invalid
 * HTML that clients re-parent: the banner and body spilled out of the card in
 * every templated email until 2026-10-15.
 */
describe("email layout", () => {
  const source = readFileSync(join(__dirname, "templates.ts"), "utf8");

  it("never puts a table row straight into a cell", () => {
    const rendered = [
      paymentSuccessHtml({ ...base, receivedAmount: 0.001, confirmedAt: "2026-09-30" }),
      billingNoticeHtml({
        merchantName: "Acme",
        title: "Fee invoice",
        lines: ["Due soon."],
        tone: "info",
        rows: [{ label: "Amount due", value: "$10" }],
        billingUrl: "https://crypteo.io/dashboard/billing",
        cta: "Pay now",
      }),
      otpCodeHtml({ title: "Login", intro: "Use this code.", code: "123456", footer: "Ignore if not you." }),
      adminMessageHtml({ merchantName: "Acme", subject: "Hi", message: "a\n\nb", dashboardUrl: "https://x.io" }),
    ];
    for (const html of rendered) expect(html).not.toMatch(/<td[^>]*>\s*<tr/);
  });

  it("starts every templated body with a block, never a row", () => {
    const bodies = [...source.matchAll(/emailLayout\(\s*`\s*(\S{0,16})/g)].map((m) => m[1]);
    expect(bodies.length).toBeGreaterThan(20);
    for (const start of bodies) expect(start).toMatch(/^(\$\{alertBanner|<table)/);
  });

  it("escapes what an admin or merchant typed", () => {
    const html = adminMessageHtml({
      merchantName: "<b>x</b>",
      subject: "<script>",
      message: "<img src=x onerror=1>",
      dashboardUrl: "javascript:alert(1)",
    });
    expect(html).not.toMatch(/<script>|<img src=x|<b>x<\/b>|javascript:/);
  });
});
