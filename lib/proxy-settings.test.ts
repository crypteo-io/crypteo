import { beforeAll, describe, expect, it } from "vitest";
import {
  decryptProxyUrl,
  encryptProxyUrl,
  isDuplicateProxy,
  parseProxyInput,
  parseProxyUrl,
  proxyView,
  type StoredProxy,
} from "./proxy-settings";

beforeAll(() => {
  process.env.TWO_FACTOR_ENCRYPTION_KEY = "k".repeat(40);
});

const URL_WITH_CREDS = "http://user:s3cret@proxy.example:8080";

describe("parseProxyUrl", () => {
  it("accepts http(s) proxy addresses, as typed", () => {
    expect(parseProxyUrl(` ${URL_WITH_CREDS} `)).toEqual({ url: URL_WITH_CREDS });
    expect(parseProxyUrl("https://proxy.example:443")).toEqual({ url: "https://proxy.example:443" });
  });

  it("refuses anything the rotation can't use", () => {
    for (const bad of ["", "proxy.example:8080", "socks5://proxy.example:1080", "http://a.example:1,http://b.example:1", "http://proxy.example:8080/path", "http://proxy.example:8080?x=1", "javascript:alert(1)"]) {
      expect(parseProxyUrl(bad)).toHaveProperty("error");
    }
  });
});

describe("proxy URL encryption", () => {
  it("round-trips, with a fresh IV each time", () => {
    const a = encryptProxyUrl(URL_WITH_CREDS);
    const b = encryptProxyUrl(URL_WITH_CREDS);
    expect(a).not.toBe(b);
    expect(a).not.toContain("s3cret");
    expect(decryptProxyUrl(a)).toBe(URL_WITH_CREDS);
  });

  it("reads tampered or foreign values as unreadable, not as a URL", () => {
    const [format, iv, tag, data] = encryptProxyUrl(URL_WITH_CREDS).split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(decryptProxyUrl([format, iv, tag, flipped.toString("base64")].join(":"))).toBeNull();
    expect(decryptProxyUrl(URL_WITH_CREDS)).toBeNull();
  });
});

describe("parseProxyInput", () => {
  it("needs a URL to create, any field to update", () => {
    expect(parseProxyInput({}, "create")).toMatchObject({ field: "url" });
    expect(parseProxyInput({}, "update")).toEqual({ error: "Nothing to change" });
    expect(parseProxyInput({ isActive: false }, "update")).toEqual({ data: { isActive: false } });
  });

  it("trims labels, blanks become null, and blames the right field", () => {
    expect(parseProxyInput({ url: URL_WITH_CREDS, label: "  EU  " }, "create")).toEqual({ data: { url: URL_WITH_CREDS, label: "EU" } });
    expect(parseProxyInput({ label: "   " }, "update")).toEqual({ data: { label: null } });
    expect(parseProxyInput({ label: "x".repeat(200) }, "update")).toMatchObject({ field: "label" });
    expect(parseProxyInput({ isActive: "yes" }, "update")).toMatchObject({ field: "isActive" });
  });
});

describe("proxyView and duplicates", () => {
  const row = (id: string, url: string | null): StoredProxy => ({
    id,
    url,
    label: null,
    isActive: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastCheckedAt: null,
    lastOkAt: null,
    lastLatencyMs: null,
    lastError: null,
    consecutiveFailures: 0,
    alertOpen: false,
    lastAlertAt: null,
  });

  it("shows the host without credentials beside the full URL", () => {
    expect(proxyView(row("a", URL_WITH_CREDS)).host).toBe("http://proxy.example:8080");
    expect(proxyView(row("a", null))).toMatchObject({ url: null, host: null });
  });

  it("finds a duplicate URL but not the row being edited", () => {
    const stored = [row("a", URL_WITH_CREDS)];
    expect(isDuplicateProxy(stored, URL_WITH_CREDS)).toBe(true);
    expect(isDuplicateProxy(stored, URL_WITH_CREDS, "a")).toBe(false);
  });
});
