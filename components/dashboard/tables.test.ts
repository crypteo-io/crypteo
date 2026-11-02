import { describe, expect, it } from "vitest";
import { sourceFiles } from "@/lib/testing/source-files";

// Dashboard tables become labelled cards below lg (.stack-table, globals.css):
// a seven-column table scrolled sideways on a phone, its first columns off
// the screen. A table without it, or a cell without its label, regresses that.
describe("dashboard tables on phones", () => {
  const files = sourceFiles(["components/dashboard", "components/billing"]).filter((f) => f.text.includes("<table"));

  it("every table stacks", () => {
    const flat = files.filter((f) => /<table className="(?![^"]*stack-table)/.test(f.text)).map((f) => f.path);
    expect(flat).toEqual([]);
  });

  it("every cell after a row's first is labelled or an actions cell", () => {
    const unlabelled = files.flatMap((f) =>
      [...f.text.matchAll(/<tbody[\s\S]*?<\/tbody>/g)].flatMap((body) => {
        const cells = [...body[0].matchAll(/<td\b[^>]*>/g)].map((m) => m[0]).filter((td) => !td.includes("colSpan"));
        return cells.slice(1).filter((td) => !/data-label="|data-actions/.test(td)).map((td) => `${f.path}: ${td}`);
      }),
    );
    expect(unlabelled).toEqual([]);
  });
});
