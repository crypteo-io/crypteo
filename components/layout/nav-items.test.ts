import { describe, expect, it } from "vitest";
import { accountLinks, activeNavGroup, dashboardNav, tabGroups, type DashboardArea } from "./nav-items";

const AREAS: DashboardArea[] = ["merchant", "admin"];

describe("dashboardNav", () => {
  it("lists each page once, with a description for the group menu", () => {
    for (const area of AREAS) {
      const items = dashboardNav(area).flatMap((g) => g.items);
      expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
      for (const item of items) expect(item.description.length).toBeGreaterThan(0);
    }
  });
});

describe("activeNavGroup", () => {
  it("finds the group of a page and of its subpages", () => {
    expect(activeNavGroup("merchant", "/dashboard")?.label).toBe("Payments");
    expect(activeNavGroup("merchant", "/dashboard/payments/abc")?.label).toBe("Payments");
    expect(activeNavGroup("merchant", "/dashboard/wallets")?.label).toBe("Setup");
    expect(activeNavGroup("admin", "/merchants/abc")?.label).toBe("Merchants");
    expect(activeNavGroup("admin", "/")?.label).toBe("Platform");
  });

  it("matches the home entry only on itself", () => {
    expect(activeNavGroup("merchant", "/dashboard/notifications")).toBeNull();
    expect(activeNavGroup("admin", "/notifications")).toBeNull();
  });
});

describe("tabGroups", () => {
  const labels = (area: DashboardArea, path: string) => tabGroups(area, path).map((g) => g.label);

  it("shows merchants every page but their account's, which the account menu holds", () => {
    expect(labels("merchant", "/dashboard/payments")).toEqual(["Payments", "Setup"]);
    expect(labels("merchant", "/dashboard/billing")).toEqual(["Account"]);
    expect(accountLinks("merchant").map((i) => i.name)).toEqual(["Settings", "Billing"]);
  });

  it("shows admins the current group only", () => {
    expect(labels("admin", "/merchants")).toEqual(["Merchants"]);
    expect(labels("admin", "/blog")).toEqual([]);
    expect(accountLinks("admin").map((i) => i.href)).toEqual(["/settings"]);
  });
});
