import { beforeEach, describe, expect, it, vi } from "vitest";

interface Device {
  id: string;
  merchantId: string;
  tokenHash: string;
  country: string | null;
  trustedAt: Date;
  expiresAt: Date;
}
interface OtpRow {
  id: string;
  email: string;
  type: string;
  code: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

const db = vi.hoisted(() => ({ devices: [] as Device[], otps: [] as OtpRow[], seq: 0 }));

vi.mock("./db", () => {
  type Key = { merchantId_tokenHash: { merchantId: string; tokenHash: string } };
  const find = ({ merchantId_tokenHash: k }: Key) =>
    db.devices.find((d) => d.merchantId === k.merchantId && d.tokenHash === k.tokenHash);
  return {
    prisma: {
      trustedDevice: {
        findUnique: async ({ where }: { where: Key }) => find(where) ?? null,
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: Key;
          create: Omit<Device, "id">;
          update: Partial<Device>;
        }) => {
          const row = find(where);
          if (row) return Object.assign(row, update);
          const created = { id: `d${++db.seq}`, ...create };
          db.devices.push(created);
          return created;
        },
        findMany: async ({ where, skip }: { where: { merchantId: string }; skip: number }) =>
          db.devices
            .filter((d) => d.merchantId === where.merchantId)
            .sort((a, b) => b.trustedAt.getTime() - a.trustedAt.getTime())
            .slice(skip),
        deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
          db.devices = db.devices.filter((d) => !where.id.in.includes(d.id));
        },
      },
      otp: {
        deleteMany: async ({ where }: { where: { email: string; type: string } }) => {
          db.otps = db.otps.filter((o) => !(o.email === where.email && o.type === where.type));
        },
        create: async ({ data }: { data: Omit<OtpRow, "id" | "attempts" | "createdAt"> }) => {
          db.otps.push({ id: `o${++db.seq}`, attempts: 0, createdAt: new Date(), ...data });
        },
        findFirst: async ({ where }: { where: { email: string; type: string; expiresAt: { gt: Date } } }) =>
          db.otps.find(
            (o) => o.email === where.email && o.type === where.type && o.expiresAt > where.expiresAt.gt,
          ) ?? null,
        delete: async ({ where }: { where: { id: string } }) => {
          db.otps = db.otps.filter((o) => o.id !== where.id);
        },
        update: async ({ where }: { where: { id: string } }) => {
          const row = db.otps.find((o) => o.id === where.id);
          if (row) row.attempts++;
        },
      },
    },
  };
});

import {
  DEVICE_COOKIE,
  deviceTokenFromCookieHeader,
  ensureDeviceToken,
  isTrustedLogin,
  issueLoginTicket,
  redeemLoginTicket,
  requestCountry,
  trustDevice,
} from "./trusted-device";

const merchant = { id: "m1", passwordChangedAt: null, sessionsRevokedAt: null };
const device = ensureDeviceToken(null).token;

beforeEach(() => {
  db.devices = [];
  db.otps = [];
  vi.useRealTimers();
});

describe("device cookie", () => {
  it("reads the device id out of a Cookie header", () => {
    expect(deviceTokenFromCookieHeader(`a=1; ${DEVICE_COOKIE}=${device}; b=2`)).toBe(device);
  });

  it("ignores a malformed or missing id", () => {
    expect(deviceTokenFromCookieHeader(`${DEVICE_COOKIE}=short`)).toBeNull();
    expect(deviceTokenFromCookieHeader(undefined)).toBeNull();
  });

  it("mints an id only when the request has none", () => {
    expect(ensureDeviceToken(device)).toEqual({ token: device, minted: false });
    expect(ensureDeviceToken(undefined).minted).toBe(true);
  });

  it("accepts only a two-letter country", () => {
    expect(requestCountry("GB")).toBe("GB");
    expect(requestCountry("<script>")).toBeNull();
    expect(requestCountry(undefined)).toBeNull();
  });
});

describe("isTrustedLogin", () => {
  it("asks for a code on a browser never remembered for this account", async () => {
    expect(await isTrustedLogin(merchant, device, "GB")).toBe(false);
    await trustDevice("m2", device, "GB");
    expect(await isTrustedLogin(merchant, device, "GB")).toBe(false);
  });

  it("skips the code on a remembered browser from the same country", async () => {
    await trustDevice("m1", device, "GB");
    expect(await isTrustedLogin(merchant, device, "GB")).toBe(true);
  });

  it("asks again from another country", async () => {
    await trustDevice("m1", device, "GB");
    expect(await isTrustedLogin(merchant, device, "NG")).toBe(false);
  });

  it("never trusts Tor", async () => {
    await trustDevice("m1", device, "T1");
    expect(db.devices).toHaveLength(0);
    expect(await isTrustedLogin(merchant, device, "T1")).toBe(false);
  });

  it("forgets the browser after 30 days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    await trustDevice("m1", device, "GB");
    vi.setSystemTime(new Date("2026-10-30T23:00:00Z"));
    expect(await isTrustedLogin(merchant, device, "GB")).toBe(true);
    vi.setSystemTime(new Date("2026-10-31T00:00:01Z"));
    expect(await isTrustedLogin(merchant, device, "GB")).toBe(false);
  });

  it("asks again after a password change or sign-out-everywhere", async () => {
    await trustDevice("m1", device, "GB");
    const later = new Date(Date.now() + 1000);
    expect(await isTrustedLogin({ ...merchant, passwordChangedAt: later }, device, "GB")).toBe(false);
    expect(await isTrustedLogin({ ...merchant, sessionsRevokedAt: later }, device, "GB")).toBe(false);
  });

  it("keeps only the ten most recently remembered browsers", async () => {
    vi.useFakeTimers();
    const tokens = Array.from({ length: 11 }, () => ensureDeviceToken(null).token);
    for (const [i, token] of tokens.entries()) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 1, 0, i)));
      await trustDevice("m1", token, "GB");
    }
    expect(db.devices).toHaveLength(10);
    expect(await isTrustedLogin(merchant, tokens[0], "GB")).toBe(false);
    expect(await isTrustedLogin(merchant, tokens[10], "GB")).toBe(true);
  });
});

describe("login tickets", () => {
  it("are spent once", async () => {
    const ticket = await issueLoginTicket("a@b.co", device);
    expect(await redeemLoginTicket("a@b.co", ticket, device)).toBe(true);
    expect(await redeemLoginTicket("a@b.co", ticket, device)).toBe(false);
  });

  it("only work from the browser they were issued to", async () => {
    const ticket = await issueLoginTicket("a@b.co", device);
    expect(await redeemLoginTicket("a@b.co", ticket, ensureDeviceToken(null).token)).toBe(false);
    expect(await redeemLoginTicket("a@b.co", ticket, null)).toBe(false);
  });

  it("expire after two minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    const ticket = await issueLoginTicket("a@b.co", device);
    vi.setSystemTime(new Date("2026-10-01T00:02:01Z"));
    expect(await redeemLoginTicket("a@b.co", ticket, device)).toBe(false);
  });

  it("are never stored as issued", async () => {
    const ticket = await issueLoginTicket("a@b.co", device);
    expect(db.otps[0].code).not.toContain(ticket);
  });
});
