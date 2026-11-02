import { describe, expect, it } from "vitest";
import { parseRangeLimit } from "./evm";
import { couldCarryMemo, isAccountMissing } from "./solana";
import { isAccountNotFound, isLedgerAnswer } from "./xrp";

// These predicates are the boundary between "the chain says there is nothing
// here" and "we could not read the chain". Tested against literal endpoint
// strings, because getting one wrong reintroduces the outage.

describe("isAccountMissing (Solana)", () => {
  it("treats a genuinely absent token account as a real zero", () => {
    expect(
      isAccountMissing(new Error("Invalid param: could not find account")),
    ).toBe(true);
    expect(isAccountMissing(new Error("Account does not exist"))).toBe(true);
  });

  it("does NOT treat a gated endpoint's refusal as an empty account", () => {
    // The exact message publicnode returns — the original bug.
    expect(
      isAccountMissing(
        new Error(
          "Indexed requests require a personal token. Get one at: https://www.allnodes.com/publicnode",
        ),
      ),
    ).toBe(false);
  });

  it("does NOT treat transport failures as an empty account", () => {
    expect(isAccountMissing(new Error("connect ETIMEDOUT"))).toBe(false);
    expect(isAccountMissing(new Error("429 Too Many Requests"))).toBe(false);
    expect(isAccountMissing(new Error("503 Service Unavailable"))).toBe(false);
  });
});

describe("isLedgerAnswer (XRP)", () => {
  it("stops failover on the ledger's own answers", () => {
    expect(isLedgerAnswer(new Error("actNotFound"))).toBe(true);
    expect(isLedgerAnswer(new Error("Account not found."))).toBe(true);
    expect(isLedgerAnswer(new Error("Account malformed."))).toBe(true);
  });

  it("does NOT treat an endpoint failure as a ledger answer", () => {
    expect(isLedgerAnswer(new Error("503 Service Unavailable"))).toBe(false);
    expect(isLedgerAnswer(new Error("socket hang up"))).toBe(false);
  });
});

describe("isAccountNotFound (XRP)", () => {
  it("treats an unactivated account as a real zero", () => {
    expect(isAccountNotFound(new Error("actNotFound"))).toBe(true);
    expect(isAccountNotFound(new Error("Account not found."))).toBe(true);
  });

  // 2026-10-14: a Solana address saved as an XRP wallet read as balance 0,
  // so checkouts opened on it and every poll failed until expiry.
  it("does NOT treat a malformed address as an empty account", () => {
    expect(isAccountNotFound(new Error("Account malformed."))).toBe(false);
    expect(isAccountNotFound(new Error("actMalformed"))).toBe(false);
    expect(isAccountNotFound(new Error("Gateway Timeout"))).toBe(false);
  });
});

describe("parseRangeLimit (EVM getLogs)", () => {
  it("reads the cap an endpoint advertises by refusing", () => {
    // 1rpc.io's actual message.
    expect(
      parseRangeLimit(new Error("eth_getLogs is limited to 0 - 50 blocks range")),
    ).toBe(50);
  });

  it("reads the cap from the \"maximum allowed\" phrasing too", () => {
    // nodies' actual message.
    expect(
      parseRangeLimit(
        new Error("Block range too large: maximum allowed is 50 blocks"),
      ),
    ).toBe(50);
  });

  it("reads Alchemy's free-tier cap", () => {
    expect(
      parseRangeLimit(
        new Error(
          "Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range.",
        ),
      ),
    ).toBe(10);
  });

  it("treats publicnode's archive complaint as a range problem, not a refusal", () => {
    // Measured: publicnode serves getLogs up to ~100 blocks and calls anything
    // wider an archive request. Narrowing works, so it must not fail over.
    expect(
      parseRangeLimit(new Error("Archive requests require a personal token")),
    ).toBe(-1);
  });

  it("signals an unknown cap when the endpoint only says the query is too big", () => {
    // drpc's actual message.
    expect(
      parseRangeLimit(
        new Error("query returns too many logs, narrow your filter: 20000"),
      ),
    ).toBe(-1);
    expect(parseRangeLimit(new Error("block range too large"))).toBe(-1);
  });

  it("returns null for errors that narrowing the range cannot fix", () => {
    expect(parseRangeLimit(new Error("connect ETIMEDOUT"))).toBeNull();
    expect(parseRangeLimit(new Error("Unauthorized"))).toBeNull();
  });
});

describe("couldCarryMemo (Solana memo prefilter)", () => {
  const memo = "073522dd";

  it("matches the listing's \"[len] text\" format", () => {
    expect(couldCarryMemo("[8] 073522dd", memo)).toBe(true);
  });

  it("rejects a different memo without a round trip", () => {
    expect(couldCarryMemo("[8] a678faec", memo)).toBe(false);
  });

  it("rejects a transaction with no memo, which can never match", () => {
    expect(couldCarryMemo(null, memo)).toBe(false);
  });

  it("still fetches when the endpoint omitted the field entirely", () => {
    // undefined is not a denial; skipping here would lose real deposits.
    expect(couldCarryMemo(undefined, memo)).toBe(true);
  });
});
