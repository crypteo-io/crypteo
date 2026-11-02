import { sourceFiles } from "../testing/source-files";
import { describe, expect, it } from "vitest";

const files = sourceFiles(["app", "lib", "workers", "scripts", "prisma"]);

/**
 * The fee bypass (for the platform's own apps) is set only by an admin, with
 * a reason, announced to every admin: app/api/admin/merchants/[id]. A second
 * writer (a merchant setting, a seed, a script) would be a quiet way round it.
 */
describe("fee exemption has one writer", () => {
  it("assigns feeExempt only in the admin merchant route", () => {
    const writers = files
      // A write is feeExempt inside a `data:` payload (selects and filters
      // name it too, outside one).
      .filter((f) => /\bdata:[^;]{0,200}?\bfeeExempt\s*:/.test(f.text))
      .map((f) => f.path);
    expect(writers).toEqual(["app/api/admin/merchants/[id]/route.ts"]);
  });

  it("requires a reason and tells every admin", () => {
    const route = files.find((f) => f.path === "app/api/admin/merchants/[id]/route.ts")!.text;
    expect(route).toMatch(/reason: z\.string\(\)\.trim\(\)\.min\(5/);
    expect(route).toMatch(/kind: "admin_fee_exemption"/);
    expect(route).toMatch(/feeExemptBy: admin\.email/);
  });
});
