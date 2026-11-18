import { describe, expect, it } from "vitest";
import { linkDescriptionSchema, linkTitleSchema } from "./validation";

// Unbounded link text fed a quadratic probe pattern (pen-test 2026-11-15).
describe("payment link text", () => {
  it("bounds the title and description", () => {
    expect(linkTitleSchema.safeParse("Pro plan").success).toBe(true);
    expect(linkTitleSchema.safeParse("x".repeat(201)).success).toBe(false);
    expect(linkTitleSchema.safeParse("   ").success).toBe(false);
    expect(linkDescriptionSchema.safeParse("y".repeat(2000)).success).toBe(true);
    expect(linkDescriptionSchema.safeParse("y".repeat(2001)).success).toBe(false);
  });
});
