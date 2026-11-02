import { afterEach, describe, expect, it, vi } from "vitest";
import { accountDashboardUrl, adminOrigin, isAdminHost, signInHostRefusal } from "./admin-host";

afterEach(() => vi.unstubAllEnvs());

describe("admin host", () => {
  it("is admin. on the site's own host, ports included", () => {
    expect(adminOrigin()).toBe("https://admin.crypteo.io");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3100");
    expect(adminOrigin()).toBe("http://admin.localhost:3100");
    expect(isAdminHost("admin.localhost:3100")).toBe(true);
    expect(isAdminHost("localhost:3100")).toBe(false);
  });

  it("matches the exact host, never a look-alike", () => {
    expect(isAdminHost("ADMIN.crypteo.io")).toBe(true);
    expect(isAdminHost("admin.crypteo.io.evil.example")).toBe(false);
    expect(isAdminHost("admin.evil.example")).toBe(false);
    expect(isAdminHost(null)).toBe(false);
  });

  it("signs admins in on the admin host and merchants on the site", () => {
    expect(signInHostRefusal("admin", "admin.crypteo.io")).toBeNull();
    expect(signInHostRefusal("merchant", "crypteo.io")).toBeNull();
    expect(signInHostRefusal("admin", "crypteo.io")).toMatch(/admin\.crypteo\.io/);
    expect(signInHostRefusal("merchant", "admin.crypteo.io")).toMatch(/Sign in at crypteo\.io/);
  });

  it("links an account's emails to its own dashboard", () => {
    expect(accountDashboardUrl("merchant", "/dashboard/wallets")).toBe("https://crypteo.io/dashboard/wallets");
    expect(accountDashboardUrl("admin", "/dashboard/wallets")).toBe("https://admin.crypteo.io/wallets");
    expect(accountDashboardUrl("admin", "/dashboard")).toBe("https://admin.crypteo.io/");
  });
});

describe("no code links to the admin pages' old /dashboard paths", async () => {
  const { sourceFiles } = await import("./testing/source-files");
  it("uses the admin host's bare paths", () => {
    const stale = sourceFiles(["app", "components", "lib", "workers", "scripts"])
      .filter((f) => f.path !== "lib/host-routing.ts")
      .filter((f) => /["`'/]dashboard\/(merchants|orphans|analytics|revenue|contact)\b/.test(f.text))
      .map((f) => f.path);
    expect(stale).toEqual([]);
  });
});
