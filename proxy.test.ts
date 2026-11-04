import { NextRequest, type NextFetchEvent } from "next/server";
import type { NextRequestWithAuth } from "next-auth/middleware";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getToken = vi.hoisted(() => vi.fn());
vi.mock("next-auth/jwt", () => ({ getToken }));

import proxy from "./proxy";

const visit = (url: string) => {
  const { host } = new URL(url);
  const req = new NextRequest(url, { headers: { host } });
  return proxy(req as NextRequestWithAuth, {} as NextFetchEvent);
};
const SITE = "https://crypteo.io";
const ADMIN = "https://admin.crypteo.io";

describe("proxy on /login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXTAUTH_URL", SITE);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("shows the login page without a valid session", async () => {
    getToken.mockResolvedValue(null);
    const res = await visit(`${SITE}/login`);
    expect(res?.headers.get("location")).toBeNull();
    expect(res?.headers.get("x-middleware-next")).toBe("1");
  });

  it("sends a signed-in merchant to the dashboard", async () => {
    getToken.mockResolvedValue({ role: "merchant" });
    const res = await visit(`${SITE}/login`);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toBe(`${SITE}/dashboard`);
  });

  it("never follows a callbackUrl", async () => {
    getToken.mockResolvedValue({ role: "merchant" });
    const res = await visit(`${SITE}/login?callbackUrl=https://evil.example/`);
    expect(res?.headers.get("location")).toBe(`${SITE}/dashboard`);
  });

  it("sends an admin session on the site to the admin host", async () => {
    getToken.mockResolvedValue({ role: "admin" });
    const res = await visit(`${SITE}/login`);
    expect(res?.headers.get("location")).toBe(`${ADMIN}/`);
  });

  it("sends a signed-in admin on the admin host to its overview", async () => {
    getToken.mockResolvedValue({ role: "admin" });
    const res = await visit(`${ADMIN}/login`);
    expect(res?.headers.get("location")).toBe(`${ADMIN}/`);
  });

  it("keeps the admin login open to anyone else", async () => {
    getToken.mockResolvedValue(null);
    const res = await visit(`${ADMIN}/login`);
    expect(res?.headers.get("location")).toBeNull();
  });
});

describe("proxy on a merchant's own domain", () => {
  it("still serves no login page, and reads no session", async () => {
    vi.clearAllMocks();
    const res = await visit("https://pay.shop.example/login");
    expect(res?.headers.get("x-middleware-rewrite")).toContain("/404");
    expect(getToken).not.toHaveBeenCalled();
  });
});
