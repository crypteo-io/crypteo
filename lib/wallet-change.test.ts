import { describe, expect, it } from "vitest";
import { CHANGE_WINDOW_MS, walletCodeRequired, type WalletChangeState } from "./wallet-change";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const base: WalletChangeState = {
  changed: true,
  occupied: true,
  usedBefore: true,
  verifiedAt: null,
  revokedAt: null,
  passwordChangedAt: null,
  now: NOW,
};
const ago = (ms: number) => new Date(NOW - ms);

describe("walletCodeRequired", () => {
  it("needs nothing when the address and tag are unchanged", () => {
    expect(walletCodeRequired({ ...base, changed: false })).toBe(false);
  });

  it("lets a slot that never held an address take its first one", () => {
    expect(walletCodeRequired({ ...base, occupied: false, usedBefore: false })).toBe(false);
  });

  it("asks when a slot that once held an address is filled again", () => {
    expect(walletCodeRequired({ ...base, occupied: false, usedBefore: true })).toBe(true);
  });

  it("asks when an occupied slot changes, even if it isn't recorded as used", () => {
    expect(walletCodeRequired({ ...base, usedBefore: false })).toBe(true);
  });

  it("skips the code inside the window and asks at its end", () => {
    expect(walletCodeRequired({ ...base, verifiedAt: ago(CHANGE_WINDOW_MS - 1) })).toBe(false);
    expect(walletCodeRequired({ ...base, verifiedAt: ago(CHANGE_WINDOW_MS) })).toBe(true);
  });

  it("closes the window when sessions are revoked or the password changes after the code", () => {
    const verifiedAt = ago(60_000);
    expect(walletCodeRequired({ ...base, verifiedAt, revokedAt: ago(30_000) })).toBe(true);
    expect(walletCodeRequired({ ...base, verifiedAt, passwordChangedAt: ago(30_000) })).toBe(true);
    expect(walletCodeRequired({ ...base, verifiedAt, passwordChangedAt: ago(120_000) })).toBe(false);
  });

  it("never trusts a verification time in the future", () => {
    expect(walletCodeRequired({ ...base, verifiedAt: new Date(NOW + 60_000) })).toBe(true);
  });
});
