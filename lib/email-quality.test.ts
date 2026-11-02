import { beforeEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({ resolveMx: vi.fn(), resolve4: vi.fn() }));
vi.mock("node:dns/promises", () => ({
  Resolver: class {
    setServers() {}
    resolveMx = dns.resolveMx;
    resolve4 = dns.resolve4;
  },
}));

import { checkEmail, emailRejectionMessage, isDisposableDomain, isDisposableEmail, isNullMx } from "./email-quality";

const dnsError = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  vi.clearAllMocks();
  dns.resolveMx.mockResolvedValue([{ exchange: "mx.example.net", priority: 10 }]);
  dns.resolve4.mockResolvedValue([]);
});

describe("isDisposableDomain", () => {
  it("catches providers from the bundled list and the ones we add", () => {
    for (const d of ["mailinator.com", "guerrillamail.com", "10minutemail.com", "yopmail.com", "temp-mail.org"]) {
      expect(isDisposableDomain(d), d).toBe(true);
    }
  });

  it("catches throwaway subdomains, any case, trailing dot", () => {
    expect(isDisposableDomain("sub.mailinator.com")).toBe(true);
    expect(isDisposableDomain("anything.yopmail.com")).toBe(true);
    expect(isDisposableDomain("MAILINATOR.COM.")).toBe(true);
  });

  it("leaves real domains alone", () => {
    for (const d of ["gmail.com", "crypteo.io", "bbc.co.uk", ""]) {
      expect(isDisposableDomain(d), d).toBe(false);
    }
  });
});

describe("isNullMx", () => {
  it("recognises the empty exchange Node returns, and the literal root", () => {
    expect(isNullMx([{ exchange: "" }])).toBe(true);
    expect(isNullMx([{ exchange: "." }])).toBe(true);
  });

  it("is only a null MX as the sole record", () => {
    expect(isNullMx([{ exchange: "mx1.mxfilter.net" }])).toBe(false);
    expect(isNullMx([{ exchange: "" }, { exchange: "mx1.example.net" }])).toBe(false);
    expect(isNullMx([])).toBe(false);
  });
});

describe("checkEmail", () => {
  it("rejects malformed and disposable addresses before any DNS work", async () => {
    for (const bad of ["nonsense", "@example.com", "a@nodot"]) {
      expect(await checkEmail(bad), bad).toBe("malformed");
    }
    expect(await checkEmail("someone@mailinator.com")).toBe("disposable");
    expect(dns.resolveMx).not.toHaveBeenCalled();
  });

  it("accepts a domain with mail exchangers", async () => {
    expect(await checkEmail("owner@example.org")).toBe("ok");
  });

  it("rejects a domain that does not exist or publishes a null MX", async () => {
    dns.resolveMx.mockRejectedValue(dnsError("ENOTFOUND"));
    dns.resolve4.mockRejectedValue(dnsError("ENOTFOUND"));
    expect(await checkEmail("a@no-such-domain.invalid")).toBe("undeliverable");

    dns.resolveMx.mockResolvedValue([{ exchange: "", priority: 0 }]);
    expect(await checkEmail("a@example.com")).toBe("undeliverable");
  });

  it("falls back to an A record when there is no MX", async () => {
    dns.resolveMx.mockRejectedValue(dnsError("ENODATA"));
    dns.resolve4.mockResolvedValue(["192.0.2.1"]);
    expect(await checkEmail("a@example.org")).toBe("ok");
  });

  it("accepts the address when the resolver itself fails", async () => {
    dns.resolveMx.mockRejectedValue(dnsError("ETIMEOUT"));
    expect(await checkEmail("a@example.org")).toBe("ok");
  });

  it("has a message for every rejection and none for ok", () => {
    expect(emailRejectionMessage("ok")).toBeNull();
    for (const v of ["disposable", "undeliverable", "malformed"] as const) {
      expect(emailRejectionMessage(v)).toBeTruthy();
    }
  });
});

describe("isDisposableEmail", () => {
  it("checks the address's domain", () => {
    expect(isDisposableEmail("probe@Mailinator.com")).toBe(true);
    expect(isDisposableEmail("owner@gmail.com")).toBe(false);
  });
});
