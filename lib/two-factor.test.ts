import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  prisma: { merchant: { findUnique: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock("./otp", () => ({ verifyOtp: vi.fn() }));

import { prisma } from "./db";
import { verifyOtp } from "./otp";
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  effectiveTwoFactorMethod,
  encryptSecret,
  findTotpStep,
  isAuthenticatorAvailable,
  totpCode,
  totpStepAt,
  totpUri,
  verifyChallenge,
} from "./two-factor";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

// RFC 6238 appendix B: the SHA-1 seed is the ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const KEY = "k".repeat(32);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TWO_FACTOR_ENCRYPTION_KEY", KEY);
});
afterEach(() => vi.unstubAllEnvs());

describe("TOTP codes match RFC 6238", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("at T=%is the code is %s", (seconds, code) => {
    expect(totpCode(RFC_SECRET, totpStepAt(seconds * 1000))).toBe(code);
  });

  it("round-trips base32", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(RFC_SECRET).toString()).toBe("12345678901234567890");
  });

  it("builds an otpauth URI authenticator apps accept", () => {
    const uri = totpUri("a@b.co", RFC_SECRET);
    expect(uri.startsWith("otpauth://totp/Crypteo%3Aa%40b.co?")).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain("issuer=Crypteo");
  });
});

describe("findTotpStep", () => {
  const now = 1111111109 * 1000;
  const step = totpStepAt(now);

  it("accepts the current code and one step of clock drift either way", () => {
    for (const s of [step - 1, step, step + 1]) {
      expect(findTotpStep(RFC_SECRET, totpCode(RFC_SECRET, s), now, null), `step ${s}`).toBe(s);
    }
  });

  it("rejects a code two steps away", () => {
    expect(findTotpStep(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now, null)).toBeNull();
  });

  it("NEVER accepts a code from a step already used", () => {
    const code = totpCode(RFC_SECRET, step);
    expect(findTotpStep(RFC_SECRET, code, now, step)).toBeNull();
    expect(findTotpStep(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, step - 1)).toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    expect(findTotpStep(RFC_SECRET, "12345", now, null)).toBeNull();
    expect(findTotpStep(RFC_SECRET, "abcdef", now, null)).toBeNull();
  });
});

describe("secret storage", () => {
  it("encrypts so the stored value is not the secret, and decrypts it back", () => {
    const stored = encryptSecret(RFC_SECRET);
    expect(stored).not.toContain(RFC_SECRET);
    expect(decryptSecret(stored)).toBe(RFC_SECRET);
  });

  it("refuses a tampered ciphertext", () => {
    const [v, iv, tag, data] = encryptSecret(RFC_SECRET).split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });

  it("fails closed without a key: enrolment is unavailable and nothing is stored in plain text", () => {
    vi.stubEnv("TWO_FACTOR_ENCRYPTION_KEY", "short");
    expect(isAuthenticatorAvailable()).toBe(false);
    expect(() => encryptSecret(RFC_SECRET)).toThrow("TWO_FACTOR_ENCRYPTION_KEY");
  });
});

describe("effectiveTwoFactorMethod", () => {
  it("only asks for an authenticator once one is fully enrolled", () => {
    expect(effectiveTwoFactorMethod({ twoFactorMethod: "totp", totpSecret: "x" })).toBe("totp");
    expect(effectiveTwoFactorMethod({ twoFactorMethod: "totp", totpSecret: null })).toBe("email");
    expect(effectiveTwoFactorMethod({ twoFactorMethod: "email", totpSecret: null })).toBe("email");
  });
});

describe("verifyChallenge (step two of login)", () => {
  const now = Date.now();
  const code = totpCode(RFC_SECRET, totpStepAt(now));

  function authenticatorAccount() {
    mock(prisma.merchant.findUnique).mockResolvedValue({
      id: "m1",
      twoFactorMethod: "totp",
      totpSecret: encryptSecret(RFC_SECRET),
      totpLastUsedStep: null,
    });
  }

  it("checks an email account's code against the mailed one", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue({
      id: "m1",
      twoFactorMethod: "email",
      totpSecret: null,
      totpLastUsedStep: null,
    });
    mock(verifyOtp).mockResolvedValue(true);
    expect(await verifyChallenge("a@b.co", "123456", "LOGIN")).toBe(true);
    expect(verifyOtp).toHaveBeenCalledWith("a@b.co", "123456", "LOGIN");
  });

  it("checks an authenticator account's code through the LOGIN challenge", async () => {
    authenticatorAccount();
    // verifyOtp enforces the challenge and attempt cap; run its matcher.
    mock(verifyOtp).mockImplementation(async (_e, submitted, _t, matches) =>
      matches(submitted, "unsent"),
    );
    mock(prisma.merchant.updateMany).mockResolvedValue({ count: 1 });
    expect(await verifyChallenge("a@b.co", code, "LOGIN")).toBe(true);
    expect(verifyOtp).toHaveBeenCalledWith("a@b.co", code, "LOGIN", expect.any(Function));
    expect(prisma.merchant.updateMany).toHaveBeenCalledWith({
      where: {
        id: "m1",
        OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: totpStepAt(now) } }],
      },
      data: { totpLastUsedStep: totpStepAt(now) },
    });
  });

  it("refuses a code a concurrent sign-in already claimed", async () => {
    authenticatorAccount();
    mock(verifyOtp).mockImplementation(async (_e, submitted, _t, matches) =>
      matches(submitted, "unsent"),
    );
    mock(prisma.merchant.updateMany).mockResolvedValue({ count: 0 });
    expect(await verifyChallenge("a@b.co", code, "LOGIN")).toBe(false);
  });

  it("does not accept the challenge's own (never sent) code for an authenticator account", async () => {
    // Pinned so "654321" is provably none of the codes in the drift window.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(59_000);
    try {
      authenticatorAccount();
      mock(verifyOtp).mockImplementation(async (_e, submitted, _t, matches) =>
        matches(submitted, "654321"),
      );
      expect(await verifyChallenge("a@b.co", "654321", "LOGIN")).toBe(false);
      expect(prisma.merchant.updateMany).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
