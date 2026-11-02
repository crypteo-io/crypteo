import { describe, expect, it } from "vitest";
import { sourceFiles } from "@/lib/testing/source-files";

// A body that isn't JSON is the caller's mistake: a bare `await req.json()`
// throws, lands in the route's catch and answers 500. A fuzzer sending
// malformed bodies to reset-password tripped the auth 5xx alert (2026-10-23).
describe("API request bodies", () => {
  it("every route reads its JSON body with a catch", () => {
    const bare = sourceFiles(["app/api"])
      .filter((f) => /\b(req|request)\.json\(\)(?!\.catch)/.test(f.text))
      .map((f) => f.path);
    expect(bare).toEqual([]);
  });
});
