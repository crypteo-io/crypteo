import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

import { maskAddress, notifyAccountSecurityChange, smtpOptions } from "./mailer";

beforeEach(() => sendMail.mockReset());

describe("smtpOptions", () => {
  it("uses implicit TLS on 465 (Cloudflare Email Service)", () => {
    const o = smtpOptions({ SMTP_HOST: "smtp.mx.cloudflare.net", SMTP_PORT: "465", SMTP_USER: "api_token" });
    expect(o).toMatchObject({ host: "smtp.mx.cloudflare.net", port: 465, secure: true, requireTLS: false });
  });

  it("requires STARTTLS on any other port, defaulting to 587", () => {
    expect(smtpOptions({ SMTP_PORT: "587" })).toMatchObject({ port: 587, secure: false, requireTLS: true });
    expect(smtpOptions({})).toMatchObject({ port: 587, secure: false, requireTLS: true });
    expect(smtpOptions({ SMTP_PORT: "nonsense" })).toMatchObject({ port: 587, requireTLS: true });
  });
});

describe("maskAddress", () => {
  it("keeps the head and tail only", () => {
    expect(maskAddress("0x742d35Cc6634C0532925a3b844Bc454e4438f44e")).toBe(
      "0x742d…f44e",
    );
  });
});

describe("notifyAccountSecurityChange", () => {
  const opts = {
    to: "owner@example.com",
    merchantName: "<img src=x>",
    action: "Receiving wallet changed",
    details: [{ label: "New address", value: "<script>1</script>" }],
    ip: "203.0.113.5",
    reviewPath: "/dashboard/wallets",
    role: "merchant",
  };

  it("sends an escaped notice with the IP", async () => {
    sendMail.mockResolvedValue({});
    await notifyAccountSecurityChange(opts);
    const { html, to, subject } = sendMail.mock.calls[0][0];
    expect(to).toBe("owner@example.com");
    expect(subject).toContain("Receiving wallet changed");
    expect(html).toContain("203.0.113.5");
    expect(html).not.toContain("<script>1");
    expect(html).not.toContain("<img src=x>");
  });
});
