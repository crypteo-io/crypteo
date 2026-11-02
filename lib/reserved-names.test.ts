import { describe, expect, it } from "vitest";
import {
  isReservedEmail,
  isReservedName,
  RESERVED_EMAIL_MESSAGE,
  RESERVED_NAME_MESSAGE,
  reservedEmailRefusal,
  reservedNameRefusal,
} from "./reserved-names";

/**
 * On a gateway built on this code a merchant registered under the platform's name: their checkout pages
 * and payment emails read as if the platform itself were billing the buyer.
 * System names ("Admin", "Root", "User") read as platform authority the same way.
 */
describe("isReservedName", () => {
  it.each([
    "Crypteo",
    "crypteo",
    "CRYPTEO",
    "Crypt-eo",
    "Crypteo Support",
    "Official Crypteo.io",
    "Crypt3o",
    "Crypte0 Payments",
    "Cryptéo",
    "Ｃｒｙｐｔｅｏ",
  ])("blocks the platform's name anywhere: %s", (name) => {
    expect(isReservedName(name)).toBe(true);
  });

  it.each(["Admin", "admin", "ADMINISTRATOR", "Root", "R00T", "User", "Root User", "System Admin", "Support Team", "sudo", "Test"])(
    "blocks a name made only of system words: %s",
    (name) => {
      expect(isReservedName(name)).toBe(true);
    },
  );

  it.each([
    "Acme Corp",
    "Crypto Coffee",
    "Encrypted Storage",
    "Payments Ltd",
    "Blockchain Pay",
    "Chainz & Payne",
    "Badminton Club",
    "Rootstock Coffee",
    "Admin Supplies Ltd",
    "User Experience Studio",
    "Test Merchant",
  ])("allows %s", (name) => {
    expect(isReservedName(name)).toBe(false);
  });
});

describe("reservedNameRefusal", () => {
  it("lets admins use the platform's names and nobody else", () => {
    expect(reservedNameRefusal("Crypteo", "admin")).toBeNull();
    expect(reservedNameRefusal("Admin", "admin")).toBeNull();
    expect(reservedNameRefusal("Crypteo", "merchant")).toBe(RESERVED_NAME_MESSAGE);
    expect(reservedNameRefusal("Admin", "merchant")).toBe(RESERVED_NAME_MESSAGE);
    expect(reservedNameRefusal("Acme Corp", "merchant")).toBeNull();
  });
});

/** Probers signed up with platform-domain addresses (support@, billing@). */
describe("isReservedEmail", () => {
  it.each([
    "support@crypteo.io",
    "Admin@Crypteo.IO",
    "x@admin.crypteo.io",
    "x@crypte-o.net",
    "x@crypte0.com",
    "a@b@crypteo.io",
  ])("blocks the platform's domain and look-alikes: %s", (email) => {
    expect(isReservedEmail(email)).toBe(true);
  });

  it.each(["crypteo@gmail.com", "x@crypto.io", "x@teo.com", "x@cryptopay.io"])("allows %s", (email) => {
    expect(isReservedEmail(email)).toBe(false);
  });

  it("lets only admins hold a platform address", () => {
    expect(reservedEmailRefusal("ops@crypteo.io", "admin")).toBeNull();
    expect(reservedEmailRefusal("ops@crypteo.io", "merchant")).toBe(RESERVED_EMAIL_MESSAGE);
  });
});
