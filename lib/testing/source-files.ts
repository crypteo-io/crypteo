import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

// The repository's own TypeScript sources, for guard tests that scan the code
// for a rule ("only this file sends mail", "only the admin route grants fee
// exemptions"). Test files are left out: they mention what they forbid.

const ROOT = join(__dirname, "..", "..");

function walk(path: string): string[] {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [path];
  return readdirSync(full).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const child = join(path, name);
    if (statSync(join(ROOT, child)).isDirectory()) return walk(child);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [child] : [];
  });
}

export interface SourceFile {
  /** Repo-relative path, e.g. "lib/mailer.ts". */
  path: string;
  text: string;
}

export function sourceFiles(roots: readonly string[]): SourceFile[] {
  return roots.flatMap(walk).map((f) => ({
    path: relative(ROOT, join(ROOT, f)),
    text: readFileSync(join(ROOT, f), "utf8"),
  }));
}
