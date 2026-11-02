import ts from "typescript";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "./testing/source-files";

// House style: no em dashes in anything a person reads (pages, checkout,
// dashboard, emails, alerts). Strings and JSX text only; code comments are
// not copy. An empty value is shown as an en dash, "–".
const EM_DASH = /—|&mdash;|\\u2014/;

function copyWithEmDashes(path: string, text: string): string[] {
  if (!EM_DASH.test(text)) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) && EM_DASH.test(node.getText(source))) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      found.push(`${path}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("copy style", () => {
  it("uses no em dashes in strings or JSX text", () => {
    const hits = sourceFiles(["app", "components", "lib", "scripts", "workers"]).flatMap((f) => copyWithEmDashes(f.path, f.text));
    expect(hits).toEqual([]);
    // Parses every source file: past the 5s default on a loaded machine.
  }, 30_000);
});
