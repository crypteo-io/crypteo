import { describe, expect, it } from "vitest";
import { dismissalValue, isDismissed } from "./webhook-notice";

const NOW = 1_000_000;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const A = "https://a.example/hook";
const B = "https://b.example/hook";

describe("webhook notice dismissal", () => {
  it("covers the dismissed URLs for a week", () => {
    const stored = dismissalValue([A], NOW);
    expect(isDismissed(stored, [A], NOW + WEEK - 1)).toBe(true);
    expect(isDismissed(stored, [A], NOW + WEEK)).toBe(false);
  });

  it("shows again when another URL starts failing", () => {
    expect(isDismissed(dismissalValue([A], NOW), [A, B], NOW)).toBe(false);
  });

  it("stays hidden when one of the dismissed URLs recovers", () => {
    expect(isDismissed(dismissalValue([A, B], NOW), [B], NOW)).toBe(true);
  });

  it("treats anything unreadable as not dismissed", () => {
    for (const stored of [null, "", "not json", "null", "[]", '{"urls":"x","until":9e15}', '{"urls":[]}']) {
      expect(isDismissed(stored, [A], NOW), String(stored)).toBe(false);
    }
  });
});
