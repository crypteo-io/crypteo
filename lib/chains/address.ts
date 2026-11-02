import { PublicKey } from "@solana/web3.js";
import {
  concat,
  decodeBase58,
  encodeBase58,
  getBytes,
  isAddress,
  sha256,
  toBeArray,
} from "ethers";
import { isValidClassicAddress } from "xrpl";

/**
 * Whether `address` is a well-formed receiving address on `chain`.
 *
 * Wallets are pasted in by merchants, and nothing downstream can recover from a
 * wrong one: a Solana address saved as the XRP wallet was handed to buyers at
 * checkout, then failed every poll with "Account malformed" until the session
 * expired. Reject it at the door instead.
 */
export function isValidAddress(chain: string, address: string): boolean {
  const addr = address.trim();
  if (!addr || addr !== address) return false;
  switch (chain.toLowerCase()) {
    case "eth":
    case "bsc":
    case "polygon":
      return isAddress(addr);
    case "sol":
      return isValidSolanaAddress(addr);
    case "xrp":
      // Classic r-address only: the adapter reads `account_info` with it, and
      // the per-session destination tag is ours, so an X-address's embedded
      // tag would conflict.
      return isValidClassicAddress(addr);
    case "btc":
      return isValidBase58Check(addr) || isValidBech32(addr);
    case "tron":
      return /^T/.test(addr) && hasBase58Version(addr, TRON_VERSIONS);
    case "doge":
      return /^[DA9]/.test(addr) && hasBase58Version(addr, DOGE_VERSIONS);
    case "zec":
      // Transparent only (t1… P2PKH, t3… P2SH, or a TEX address, which
      // normalizeAddress turns into its t1… form). Shielded and unified
      // addresses hide balances by design, so no public API can watch one for
      // deposits — accepting it would hand buyers an address we can never
      // detect.
      if (decodeTex(addr)) return true;
      return /^t[13]/.test(addr) && hasBase58Version(addr, ZEC_VERSIONS);
    case "ada":
      return isValidCardanoAddress(addr);
    default:
      return false;
  }
}

/**
 * The canonical form of `address` for storage and chain reads. Returns the
 * input unchanged unless the chain has an equivalent spelling indexers can't
 * read.
 *
 * Zcash TEX addresses (ZIP-320, tex1…) are a transparent P2PKH address
 * re-encoded so sending wallets refuse shielded funds. Indexers look up the
 * t1… form, and the checkout only ever asks for a transparent send, so the
 * t1… form is stored.
 */
export function normalizeAddress(chain: string, address: string): string {
  if (chain.toLowerCase() === "zec") {
    const hash = decodeTex(address);
    if (hash) return base58Check(new Uint8Array([...ZEC_VERSIONS[0], ...hash]));
  }
  return address;
}

function base58Check(payload: Uint8Array): string {
  const checksum = getBytes(sha256(sha256(payload))).slice(0, 4);
  return encodeBase58(concat([payload, checksum]));
}

/** The 20-byte P2PKH hash in a mainnet TEX address, or null. */
function decodeTex(addr: string): Uint8Array | null {
  if (addr !== addr.toLowerCase() || !addr.startsWith("tex1")) return null;
  const data: number[] = [];
  for (const c of addr.slice(4)) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v === -1) return null;
    data.push(v);
  }
  const hrp = [..."tex"].map((c) => c.charCodeAt(0));
  const expanded = [...hrp.map((c) => c >> 5), 0, ...hrp.map((c) => c & 31)];
  // ZIP-320 uses bech32m.
  if (bech32Polymod([...expanded, ...data]) !== BECH32M_CONST) return null;
  const groups = data.slice(0, -6);
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const g of groups) {
    acc = (acc << 5) | g;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || (acc & ((1 << bits) - 1)) !== 0) return null;
  return out.length === 20 ? new Uint8Array(out) : null;
}

function isValidSolanaAddress(addr: string): boolean {
  try {
    new PublicKey(addr); // Throws unless it decodes to exactly 32 bytes.
    return true;
  } catch {
    return false;
  }
}

// ── Base58Check (Bitcoin-family, Tron) ──

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Decode Base58Check, verifying the checksum. Null if it isn't valid. */
function decodeBase58Check(addr: string): Uint8Array | null {
  if (!BASE58_RE.test(addr) || addr.length < 26 || addr.length > 36) {
    return null;
  }
  try {
    // Each leading "1" encodes a zero byte that the bigint decode drops.
    const leadingZeros = addr.match(/^1*/)![0].length;
    const body = toBeArray(decodeBase58(addr));
    const bytes = new Uint8Array(leadingZeros + body.length);
    bytes.set(body, leadingZeros);
    if (bytes.length < 5) return null;
    const payload = bytes.slice(0, -4);
    const checksum = getBytes(sha256(sha256(payload))).slice(0, 4);
    return checksum.every((b, i) => b === bytes[payload.length + i])
      ? payload
      : null;
  } catch {
    return null;
  }
}

/**
 * Base58Check address whose version prefix is one of `versions` followed by a
 * 20-byte hash. The prefix is what tells chains apart: a Bitcoin address has a
 * valid checksum too, and would otherwise pass as a Dogecoin one.
 */
function hasBase58Version(addr: string, versions: number[][]): boolean {
  const payload = decodeBase58Check(addr);
  if (!payload) return false;
  return versions.some(
    (v) =>
      payload.length === v.length + 20 && v.every((b, i) => payload[i] === b),
  );
}

const TRON_VERSIONS = [[0x41]];
// P2PKH (D…) and P2SH (9…/A…).
const DOGE_VERSIONS = [[0x1e], [0x16]];
// Two-byte prefixes: t1 (P2PKH) and t3 (P2SH).
const ZEC_VERSIONS = [
  [0x1c, 0xb8],
  [0x1c, 0xbd],
];

// ── Bitcoin mainnet ──
const P2PKH_VERSION = 0x00;
const P2SH_VERSION = 0x05;

/** Legacy P2PKH (1…) or P2SH (3…) address with a valid checksum. */
function isValidBase58Check(addr: string): boolean {
  if (!/^[13]/.test(addr) || addr.length < 26 || addr.length > 35) return false;
  if (!BASE58_RE.test(addr)) return false;
  try {
    // Each leading "1" encodes a zero byte that the bigint decode drops.
    const leadingZeros = addr.match(/^1*/)![0].length;
    const body = toBeArray(decodeBase58(addr));
    const bytes = new Uint8Array(leadingZeros + body.length);
    bytes.set(body, leadingZeros);
    if (bytes.length !== 25) return false;
    if (bytes[0] !== P2PKH_VERSION && bytes[0] !== P2SH_VERSION) return false;
    const payload = bytes.slice(0, 21);
    const checksum = getBytes(sha256(sha256(payload))).slice(0, 4);
    return checksum.every((b, i) => b === bytes[21 + i]);
  } catch {
    return false;
  }
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

/** Native SegWit bc1… address (BIP-173 v0, BIP-350 v1+) with a valid checksum. */
function isValidBech32(addr: string): boolean {
  // Mixed case is invalid bech32; normalise only an all-upper address.
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) return false;
  const lower = addr.toLowerCase();
  if (!lower.startsWith("bc1") || lower.length < 14 || lower.length > 74) {
    return false;
  }
  const data: number[] = [];
  for (const c of lower.slice(3)) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v === -1) return false;
    data.push(v);
  }
  const hrp = [...lower.slice(0, 2)].map((c) => c.charCodeAt(0));
  const expanded = [...hrp.map((c) => c >> 5), 0, ...hrp.map((c) => c & 31)];
  const polymod = bech32Polymod([...expanded, ...data]);

  const version = data[0];
  if (version > 16) return false;
  const expected = version === 0 ? BECH32_CONST : BECH32M_CONST;
  if (polymod !== expected) return false;

  // Witness program: 5-bit groups (minus version + 6 checksum chars) → bytes.
  const programBits = (data.length - 7) * 5;
  const programBytes = Math.floor(programBits / 8);
  if (programBits % 8 >= 5) return false; // Excess padding.
  if (version === 0) return programBytes === 20 || programBytes === 32;
  return programBytes >= 2 && programBytes <= 40;
}

// ── Cardano mainnet ──

/**
 * Shelley-era mainnet payment address (addr1…), bech32 with a valid checksum.
 *
 * Cardano addresses run past bech32's 90-character limit, so a generic bech32
 * library rejects them; the checksum itself is unchanged. Byron-era (Ae2…,
 * DdzFF…) and stake (stake1…) addresses are refused — the former are legacy
 * and the latter cannot receive a payment.
 */
function isValidCardanoAddress(addr: string): boolean {
  if (addr !== addr.toLowerCase()) return false;
  if (!addr.startsWith("addr1") || addr.length < 58 || addr.length > 130) {
    return false;
  }
  const data: number[] = [];
  for (const c of addr.slice(5)) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v === -1) return false;
    data.push(v);
  }
  const hrp = [..."addr"].map((c) => c.charCodeAt(0));
  const expanded = [...hrp.map((c) => c >> 5), 0, ...hrp.map((c) => c & 31)];
  if (bech32Polymod([...expanded, ...data]) !== BECH32_CONST) return false;

  // 5-bit groups (minus the 6 checksum chars) → bytes; leftover bits are
  // padding and must be zero, or the string isn't a canonical encoding.
  const groups = data.slice(0, -6);
  const bits = groups.length * 5;
  if (bits % 8 >= 5) return false;
  const padBits = bits % 8;
  if (padBits && groups[groups.length - 1] & ((1 << padBits) - 1)) return false;
  const bytes = Math.floor(bits / 8);

  // Header: address type (0-7 carry a payment credential) and network id
  // (1 = mainnet). The header is the first 8 bits of the data.
  const header = (groups[0] << 3) | (groups[1] >> 2);
  const type = header >> 4;
  const network = header & 0x0f;
  if (type > 7 || network !== 1) return false;

  // Payload length is fixed by the type (CIP-19): base = header + payment +
  // stake credential (1+28+28); enterprise = header + payment (1+28); pointer
  // = header + payment + a variable-length chain pointer (≥ 3 bytes). A
  // checksum-valid string of the wrong length is not an address Koios knows,
  // and would read as an empty wallet forever.
  if (type <= 3) return bytes === 57;
  if (type <= 5) return bytes >= 32;
  return bytes === 29;
}
