import { beforeEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({ resolveMx: vi.fn(), resolve4: vi.fn(), reverse: vi.fn() }));
vi.mock("node:dns/promises", () => ({
  Resolver: class {
    setServers() {}
    resolveMx = dns.resolveMx;
    resolve4 = dns.resolve4;
    reverse = dns.reverse;
  },
}));

import {
  checkEmail,
  emailRejectionMessage,
  inboxKey,
  isDisposableDomain,
  isDisposableEmail,
  isNullMx,
  suspiciousEmailReason,
} from "./email-quality";

const dnsError = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  vi.clearAllMocks();
  dns.resolveMx.mockResolvedValue([{ exchange: "mx.example.net", priority: 10 }]);
  dns.resolve4.mockResolvedValue([]);
  dns.reverse.mockResolvedValue([]);
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

// The addresses a prober used on 2026-11-15, and real ones that must pass.
describe("throwaway domains no list has yet", () => {
  it("refuses wildcard-DNS and IP-named hosts", () => {
    for (const d of ["shop.203.0.113.7.sslip.io", "x.10-0-0-1.nip.io", "198.51.100.21.example.com", "mail-1-2-3-4.example.net"]) {
      expect(isDisposableDomain(d), d).toBe(true);
    }
  });

  it("refuses a domain that names itself a throwaway service", () => {
    for (const d of ["my-tempmail.xyz", "throwaway-inbox.net", "burnermail.example", "10minutemail.cc"]) {
      expect(isDisposableDomain(d), d).toBe(true);
    }
  });

  it("refuses a domain whose MX is a listed throwaway service", async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: "in.mail.tm", priority: 10 }]);
    expect(await checkEmail("anna@fldubai.com")).toBe("disposable");
    dns.resolveMx.mockResolvedValue([{ exchange: "mail.burnermail.io", priority: 1 }]);
    expect(await checkEmail("anna@mailerq.net")).toBe("disposable");
  });

  it("accepts ordinary providers and business domains", async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: "gmail-smtp-in.l.google.com", priority: 5 }]);
    expect(await checkEmail("marco.bianchi96@gmail.com")).toBe("ok");
    for (const d of ["gmail.com", "harbor-coffee.com", "schmidt.de", "temple.edu"]) expect(isDisposableDomain(d), d).toBe(false);
  });
});

describe("suspiciousEmailReason", () => {
  it("flags the generated and probing addresses seen", () => {
    for (const e of ["k3ttrw@gmail.com", "shopx78kkzq@fldubai.com", "tomtom418@gmail.com", "sqli7@fldubai.com", "mysqli@fldubai.com", "test123@gmail.com", "a3f9c2e1b7d4@gmail.com", "qwerty.pay@gmail.com", "user@shop.tk"]) {
      expect(suspiciousEmailReason(e), e).not.toBeNull();
    }
  });

  it("leaves real addresses alone", () => {
    for (const e of ["marco.bianchi96@gmail.com", "trnqvela@gmail.com", "k.novak@gmail.com", "mario.rossi87@libero.it", "info@harbor-coffee.com", "jo@company.com", "christopher@schmidt.de", "ana.lopez1990@hotmail.com", "contest.team@brand.com"]) {
      expect(suspiciousEmailReason(e), e).toBeNull();
    }
  });
});

describe("inboxKey", () => {
  it("folds Gmail dots and +tags, and only +tags elsewhere", () => {
    expect(inboxKey("To.m+shop2@gmail.com")).toBe("tom@gmail.com");
    expect(inboxKey("tom@googlemail.com")).toBe("tom@gmail.com");
    expect(inboxKey("a.b+x@example.com")).toBe("a.b@example.com");
  });
});

describe("throwaway mail servers named after the domain (2026-11-16)", () => {
  it("refuses a domain whose mail server's address reverses to a throwaway service", async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: "mail.tanpony.com", priority: 10 }]);
    dns.resolve4.mockImplementation(async (host: string) => (host === "mail.tanpony.com" ? ["198.51.100.158"] : []));
    dns.reverse.mockResolvedValue(["forward3.mail.temp-mail.io"]);
    expect(await checkEmail("anna@tanpony.com")).toBe("disposable");
  });

  it("accepts when the reverse name is ordinary or the lookups fail", async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: "mx.example-business.com", priority: 10 }]);
    dns.resolve4.mockResolvedValue(["203.0.113.7"]);
    dns.reverse.mockResolvedValue(["mx1.mailhost.example.net"]);
    expect(await checkEmail("owner@example-business.com")).toBe("ok");
    dns.reverse.mockRejectedValue(dnsError("ETIMEOUT"));
    expect(await checkEmail("owner@example-business.com")).toBe("ok");
  });
});

describe("suspicious addresses are refused (user, 2026-11-16)", () => {
  it("refuses a machine-made address before any DNS lookup", async () => {
    expect(await checkEmail("qx7r2mfk9td@gmail.com")).toBe("suspicious");
    expect(await checkEmail("tomtom418@gmail.com")).toBe("suspicious");
    expect(dns.resolveMx).not.toHaveBeenCalled();
    expect(emailRejectionMessage("suspicious")).not.toMatch(/digit|letter|repeat|generated|keyboard/i);
  });
});
