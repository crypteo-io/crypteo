import { describe, expect, it } from "vitest";
import { isValidAddress, normalizeAddress } from "./address";

describe("isValidAddress", () => {
  it("rejects the Solana address that was saved as an XRP wallet in prod", () => {
    const sol = "B8JGsTo5x4wUwP5xvsKiKTR41eN1ZTd7wNFbQDnoaDku";
    expect(isValidAddress("xrp", sol)).toBe(false);
    expect(isValidAddress("sol", sol)).toBe(true);
  });

  it("validates Ethereum addresses, including the EIP-55 checksum", () => {
    const addr = "0x6d7f880dDDBCb37d721e0d5D7a0d2bE2Bc9aDC96";
    expect(isValidAddress("eth", addr)).toBe(true);
    expect(isValidAddress("eth", addr.toLowerCase())).toBe(true);
    expect(isValidAddress("eth", addr.replace("dDDB", "dDdB"))).toBe(false);
    expect(isValidAddress("eth", addr.slice(0, -1))).toBe(false);
  });

  it("validates Solana addresses", () => {
    expect(isValidAddress("sol", "0x6d7f880dDDBCb37d721e0d5D7a0d2bE2Bc9aDC96")).toBe(false);
    expect(isValidAddress("sol", "B8JGsTo5x4wUwP5xvsKiKTR41eN1ZTd7wNFbQDno")).toBe(false);
  });

  it("validates classic XRP addresses", () => {
    expect(isValidAddress("xrp", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh")).toBe(true);
    expect(isValidAddress("xrp", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTi")).toBe(false);
  });

  it("validates Bitcoin legacy, P2SH, SegWit and Taproot addresses", () => {
    expect(isValidAddress("btc", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe(true);
    expect(isValidAddress("btc", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe(true);
    expect(isValidAddress("btc", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe(true);
    expect(
      isValidAddress("btc", "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0"),
    ).toBe(true);
    // Bad checksums
    expect(isValidAddress("btc", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb")).toBe(false);
    expect(isValidAddress("btc", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdr")).toBe(false);
    // Testnet and other networks
    expect(isValidAddress("btc", "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")).toBe(false);
    expect(isValidAddress("btc", "0x6d7f880dDDBCb37d721e0d5D7a0d2bE2Bc9aDC96")).toBe(false);
  });

  it("rejects surrounding whitespace, empty input and unknown chains", () => {
    expect(isValidAddress("xrp", " rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh")).toBe(false);
    expect(isValidAddress("eth", "")).toBe(false);
    expect(isValidAddress("ltc", "LdP8Qox1VAhCzLJNqrr74YovaWYyNBUWvL")).toBe(false);
  });

  it("validates BSC and Polygon addresses as EVM addresses", () => {
    const addr = "0xF977814e90dA44bFA03b6295A0616a897441aceC";
    expect(isValidAddress("bsc", addr)).toBe(true);
    expect(isValidAddress("polygon", addr)).toBe(true);
    expect(isValidAddress("bsc", addr.replace("F977", "F978"))).toBe(false);
    expect(isValidAddress("polygon", "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL")).toBe(false);
  });

  it("validates Tron base58 addresses by version byte and checksum", () => {
    expect(isValidAddress("tron", "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL")).toBe(true);
    expect(isValidAddress("tron", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe(true);
    expect(isValidAddress("tron", "TA4Y62o6YC2Zsck9rZVGTvqW1AQ7X9zTnj")).toBe(true);
    // One character off breaks the checksum.
    expect(isValidAddress("tron", "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeM")).toBe(false);
    // A hex (41…) or EVM address is not what merchants should paste.
    expect(isValidAddress("tron", "0xF977814e90dA44bFA03b6295A0616a897441aceC")).toBe(false);
    // A valid Bitcoin address has a valid checksum but the wrong version.
    expect(isValidAddress("tron", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe(false);
  });

  it("validates Dogecoin P2PKH and P2SH addresses, not Bitcoin ones", () => {
    expect(isValidAddress("doge", "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L")).toBe(true);
    expect(isValidAddress("doge", "9rXbkMyi1S6thykRoXAZcY8fwUKYsy6cXE")).toBe(true);
    expect(isValidAddress("doge", "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7M")).toBe(false);
    // Same 20-byte hash under Bitcoin's version byte.
    expect(isValidAddress("doge", "16L5yRNPTuciSgXGHqYwn9N6NeoKqopAu")).toBe(false);
    expect(isValidAddress("btc", "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L")).toBe(false);
  });

  it("accepts only transparent Zcash addresses", () => {
    expect(isValidAddress("zec", "t1XQZdZMnzXBcL8yx2PR27dSNrqctgwLgux")).toBe(true);
    expect(isValidAddress("zec", "t3Jex1rKwuh1bQFRrKpKGWDcDVZ8bbQuNrB")).toBe(true);
    expect(isValidAddress("zec", "t1XQZdZMnzXBcL8yx2PR27dSNrqctgwLguy")).toBe(false);
    // Sapling and unified addresses can't be watched for deposits.
    expect(
      isValidAddress(
        "zec",
        "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly",
      ),
    ).toBe(false);
    expect(isValidAddress("zec", "u1qwerty")).toBe(false);
  });

  it("validates Cardano mainnet Shelley addresses", () => {
    expect(
      isValidAddress(
        "ada",
        "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x",
      ),
    ).toBe(true);
    // Enterprise (payment key only) address.
    expect(
      isValidAddress("ada", "addr1vyqqzqsrqszsvpcgpy9qkrqdpc83qygjzv2p29shrqv35xcjrvarg"),
    ).toBe(true);
  });

  it("rejects Cardano addresses with a bad checksum, wrong network or no payment part", () => {
    expect(
      isValidAddress(
        "ada",
        "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3y",
      ),
    ).toBe(false);
    expect(
      isValidAddress(
        "ada",
        "addr_test1qqqqzqsrqszsvpcgpy9qkrqdpc83qygjzv2p29shrqv35xcur50p7gppyg3jgffxyu5zj23t9skjutesxyerxdp4xcms4dg6wp",
      ),
    ).toBe(false);
    // Valid checksum, but the header says testnet (network id 0).
    expect(
      isValidAddress(
        "ada",
        "addr1qqqqzqsrqszsvpcgpy9qkrqdpc83qygjzv2p29shrqv35xcur50p7gppyg3jgffxyu5zj23t9skjutesxyerxdp4xcms8duasr",
      ),
    ).toBe(false);
    // Valid checksum, but a reward (stake) header that can't receive payment.
    expect(
      isValidAddress("ada", "addr1uyqqzqsrqszsvpcgpy9qkrqdpc83qygjzv2p29shrqv35xcg36alg"),
    ).toBe(false);
    // Valid checksum, base-address header, but the payload is 29 bytes (an
    // enterprise length): no such address exists on chain.
    expect(
      isValidAddress("ada", "addr1qyqqzqsrqszsvpcgpy9qkrqdpc83qygjzv2p29shrqv35xcd6ka2g"),
    ).toBe(false);
    expect(
      isValidAddress(
        "ada",
        "ADDR1QX2FXV2UMYHTTKXYXP8X0DLPDT3K6CWNG5PXJ3JHSYDZER3N0D3VLLMYQWSX5WKTCD8CC3SQ835LU7DRV2XWL2WYWFGSE35A3X",
      ),
    ).toBe(false);
  });

  it("accepts a Zcash TEX address and stores its t1 form (ZIP-320 test vector)", () => {
    const tex = "tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte";
    expect(isValidAddress("zec", tex)).toBe(true);
    expect(normalizeAddress("zec", tex)).toBe("t1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC");
    expect(isValidAddress("zec", "tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgtf")).toBe(false);
    // Other chains and ordinary addresses pass through untouched.
    expect(normalizeAddress("btc", tex)).toBe(tex);
    expect(normalizeAddress("zec", "t1XQZdZMnzXBcL8yx2PR27dSNrqctgwLgux")).toBe(
      "t1XQZdZMnzXBcL8yx2PR27dSNrqctgwLgux",
    );
  });
});
